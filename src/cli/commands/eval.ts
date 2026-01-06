import { Command, Option } from "commander";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import pLimit from "p-limit";

import { loadConfig, type ShipSpecSecrets } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { createSecretsStore } from "../../core/secrets/secrets-store.js";
import { findProjectRoot } from "../../core/project/project-state.js";
import { logger } from "../../utils/logger.js";
import { CliUsageError, CliRuntimeError } from "../errors.js";

import { loadDataset } from "../../evals/datasets/loader.js";
import type {
  EvalWorkflow,
  Evaluator,
  EvaluatorParams,
  EvaluationResult,
} from "../../evals/types.js";

import {
  reportQualityEvaluator,
  findingAccuracyEvaluator,
} from "../../evals/evaluators/productionalize/index.js";
import {
  prdQualityEvaluator,
  specQualityEvaluator,
  taskActionabilityEvaluator,
} from "../../evals/evaluators/planning/index.js";
import {
  answerRelevanceEvaluator,
  citationAccuracyEvaluator,
} from "../../evals/evaluators/ask/index.js";

import {
  createProductionalizeRunner,
  type ProductionalizeRunnerConfig,
} from "../../evals/runners/productionalize-runner.js";
import {
  createPlanningRunner,
  type PlanningRunnerConfig,
} from "../../evals/runners/planning-runner.js";
import { createAskRunner, type AskRunnerConfig } from "../../evals/runners/ask-runner.js";

/**
 * Commander options for the eval command.
 */
interface EvalCommanderOptions {
  workflow?: "productionalize" | "planning" | "ask" | "all";
  dataset?: string;
  localOnly?: boolean;
  maxConcurrency?: number;
  experimentPrefix?: string;
  resolvedConfig?: ShipSpecConfig;
}

/**
 * Normalized options for the eval action.
 */
interface EvalOptions {
  workflow: EvalWorkflow | "all";
  dataset?: string;
  localOnly: boolean;
  maxConcurrency: number;
  experimentPrefix: string;
}

/**
 * Wraps an evaluator to match LangSmith's expected format.
 * LangSmith v0.2+ expects evaluators with { inputs, outputs, referenceOutputs } signature.
 */
function wrapEvaluator(evaluator: Evaluator) {
  return async (args: {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    referenceOutputs?: Record<string, unknown>;
  }) => {
    const evalParams: EvaluatorParams = {
      inputs: args.inputs,
      outputs: args.outputs,
      referenceOutputs: args.referenceOutputs,
    };
    return evaluator(evalParams);
  };
}

/**
 * Gets the evaluators for a specific workflow.
 */
function getWorkflowEvaluators(workflow: EvalWorkflow): Evaluator[] {
  switch (workflow) {
    case "productionalize":
      return [reportQualityEvaluator, findingAccuracyEvaluator];
    case "planning":
      return [prdQualityEvaluator, specQualityEvaluator, taskActionabilityEvaluator];
    case "ask":
      return [answerRelevanceEvaluator, citationAccuracyEvaluator];
  }
}

/**
 * Creates a target runner for a specific workflow.
 */
function createWorkflowRunner(
  workflow: EvalWorkflow,
  config: ShipSpecConfig,
  secrets: ShipSpecSecrets
) {
  const runnerConfig: ProductionalizeRunnerConfig | PlanningRunnerConfig | AskRunnerConfig = {
    config,
    secrets,
  };

  switch (workflow) {
    case "productionalize":
      return createProductionalizeRunner(runnerConfig);
    case "planning":
      return createPlanningRunner(runnerConfig);
    case "ask":
      return createAskRunner(runnerConfig);
  }
}

/**
 * Local evaluation result summary entry.
 */
interface LocalEvalSummaryEntry {
  mean: number;
  count: number;
}

/**
 * Runs evaluations locally without uploading to LangSmith.
 * This is used when --local-only flag is set.
 */
async function runLocalEval(
  workflow: EvalWorkflow,
  options: EvalOptions,
  config: ShipSpecConfig,
  secrets: ShipSpecSecrets,
  _datasetName: string,
  examples: { inputs: Record<string, unknown>; outputs?: Record<string, unknown> }[]
): Promise<void> {
  const runner = createWorkflowRunner(workflow, config, secrets);
  const evaluators = getWorkflowEvaluators(workflow);

  const limit = pLimit(options.maxConcurrency);
  const allResults: EvaluationResult[][] = [];

  logger.progress(`Running ${String(examples.length)} examples locally...`);

  const tasks = examples.map((example, idx) =>
    limit(async () => {
      try {
        // Run the target function
        // We use unknown as intermediate to handle the type variance between
        // different workflow input/output types
        const runnerFn = runner as (inputs: unknown) => Promise<unknown>;
        const rawOutputs = await runnerFn(example.inputs);
        const outputs = rawOutputs as Record<string, unknown>;

        // Run all evaluators
        const evalParams: EvaluatorParams = {
          inputs: example.inputs,
          outputs,
          referenceOutputs: example.outputs,
        };

        const results: EvaluationResult[] = [];
        for (const evaluator of evaluators) {
          const evalResults = await evaluator(evalParams);
          results.push(...evalResults);
        }

        logger.info(`  Example ${String(idx + 1)}/${String(examples.length)} complete`);
        return results;
      } catch (err) {
        logger.warn(
          `  Example ${String(idx + 1)} failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return [];
      }
    })
  );

  allResults.push(...(await Promise.all(tasks)));

  // Calculate summary statistics
  const summary = new Map<string, LocalEvalSummaryEntry>();
  for (const results of allResults) {
    for (const result of results) {
      const existing = summary.get(result.key);
      if (existing) {
        existing.mean = (existing.mean * existing.count + result.score) / (existing.count + 1);
        existing.count++;
      } else {
        summary.set(result.key, { mean: result.score, count: 1 });
      }
    }
  }

  // Log summary
  logger.success(`${workflow} local evaluation complete!`);
  for (const [key, value] of summary) {
    logger.info(`  ${key}: ${value.mean.toFixed(3)} (n=${String(value.count)})`);
  }
}

/**
 * Runs evaluations for a single workflow.
 */
async function runWorkflowEval(
  workflow: EvalWorkflow,
  options: EvalOptions,
  config: ShipSpecConfig,
  secrets: ShipSpecSecrets,
  client: Client | null
): Promise<void> {
  const datasetName = options.dataset ?? config.eval?.projectName ?? `shipspec-${workflow}`;

  logger.progress(`Running ${workflow} evaluations with dataset: ${datasetName}`);

  // Load dataset - for local-only mode, only load from local files
  let examples: { inputs: Record<string, unknown>; outputs?: Record<string, unknown> }[];
  try {
    if (options.localOnly) {
      // Local-only: only load from local files, fail with clear error if not found
      examples = await loadDataset(datasetName, workflow, { localOnly: true });
    } else {
      examples = await loadDataset(datasetName, workflow, {
        client: client ?? undefined,
        apiKey: secrets.langsmithApiKey,
      });
    }
  } catch (err) {
    logger.warn(
      `Failed to load dataset for ${workflow}: ${err instanceof Error ? err.message : String(err)}`
    );
    logger.warn(`Skipping ${workflow} evaluation.`);
    return;
  }

  if (examples.length === 0) {
    logger.warn(`No examples found in dataset for ${workflow}. Skipping.`);
    return;
  }

  logger.info(`Loaded ${String(examples.length)} examples for ${workflow}`);

  // Use local evaluation when --local-only is set
  if (options.localOnly) {
    await runLocalEval(workflow, options, config, secrets, datasetName, examples);
    return;
  }

  // Remote evaluation using LangSmith
  if (!client) {
    throw new CliRuntimeError(
      `LangSmith client required for remote evaluation of ${workflow}`,
      new Error("Client is null")
    );
  }

  // Create runner and evaluators
  const runner = createWorkflowRunner(workflow, config, secrets);
  const evaluators = getWorkflowEvaluators(workflow).map(wrapEvaluator);

  // Run evaluation
  try {
    const results = await evaluate(runner, {
      client,
      data: datasetName,
      evaluators,
      experimentPrefix: `${options.experimentPrefix}-${workflow}`,
      maxConcurrency: options.maxConcurrency,
    });

    // Collect results by iterating over the async iterable to completion
    // ExperimentResults is an async iterable of ExperimentResultRow
    const summary = new Map<string, { sum: number; count: number }>();

    for await (const result of results) {
      // Each result has an evaluationResults property with evaluation feedback
      const evalResults = result.evaluationResults.results;
      for (const evalResult of evalResults) {
        const { key, score } = evalResult;
        // score can be number | boolean | undefined; only aggregate numeric scores
        if (typeof score === "number") {
          const existing = summary.get(key);
          if (existing) {
            existing.sum += score;
            existing.count++;
          } else {
            summary.set(key, { sum: score, count: 1 });
          }
        }
      }
    }

    // Log summary
    logger.success(`${workflow} evaluation complete!`);

    for (const [key, { sum, count }] of summary) {
      const mean = sum / count;
      logger.info(`  ${key}: ${mean.toFixed(3)} (n=${String(count)})`);
    }

    if (summary.size === 0) {
      logger.info("  No evaluation results collected.");
    }
  } catch (err) {
    throw new CliRuntimeError(`Evaluation failed for ${workflow}`, err);
  }
}

/**
 * Main action handler for the eval command.
 */
async function evalAction(cmdOpts: EvalCommanderOptions): Promise<void> {
  // Find project root first to load config for normalizing options
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    throw new CliUsageError("This directory has not been initialized. Run `ship-spec init` first.");
  }

  // Load config early to determine localOnly from uploadResults setting
  const { config, secrets: loadedSecrets } = cmdOpts.resolvedConfig
    ? { config: cmdOpts.resolvedConfig, secrets: {} as ShipSpecSecrets }
    : await loadConfig(projectRoot, {}, { verbose: process.argv.includes("--verbose") });

  // Determine effective localOnly: CLI flag OR config uploadResults=false
  // When uploadResults is false, we run evaluations locally without uploading
  const effectiveLocalOnly =
    cmdOpts.localOnly ?? (config.eval?.uploadResults === false ? true : false);

  // Normalize options
  const options: EvalOptions = {
    workflow: cmdOpts.workflow ?? "all",
    dataset: cmdOpts.dataset,
    localOnly: effectiveLocalOnly,
    maxConcurrency: cmdOpts.maxConcurrency ?? config.eval?.maxConcurrency ?? 3,
    experimentPrefix: cmdOpts.experimentPrefix ?? "shipspec",
  };

  // Resolve secrets
  const secretsStore = createSecretsStore(projectRoot);
  const resolvedSecrets: ShipSpecSecrets = { ...loadedSecrets };

  // Get LangSmith API key
  resolvedSecrets.langsmithApiKey ??= config.eval?.langsmithApiKey ?? process.env.LANGSMITH_API_KEY;

  if (!resolvedSecrets.langsmithApiKey && !options.localOnly) {
    throw new CliUsageError(
      "LANGSMITH_API_KEY not found. Set it via environment variable, config, or use --local-only."
    );
  }

  // Get LLM API key for runners
  if (config.llm.provider === "openrouter" && !resolvedSecrets.llmApiKey) {
    const openrouterKey = await secretsStore.get("OPENROUTER_API_KEY");
    if (!openrouterKey) {
      throw new CliUsageError(
        "OpenRouter API key not found. Run `ship-spec init` or set OPENROUTER_API_KEY."
      );
    }
    resolvedSecrets.llmApiKey = openrouterKey;
  }

  // Get embedding API key
  if (config.embedding.provider === "openrouter" && !resolvedSecrets.embeddingApiKey) {
    const openrouterKey = await secretsStore.get("OPENROUTER_API_KEY");
    if (!openrouterKey) {
      throw new CliUsageError(
        "OpenRouter API key not found. Run `ship-spec init` or set OPENROUTER_API_KEY."
      );
    }
    resolvedSecrets.embeddingApiKey = openrouterKey;
  }

  // Get Tavily API key for productionalize
  if (!resolvedSecrets.tavilyApiKey) {
    const tavilyKey = await secretsStore.get("TAVILY_API_KEY");
    resolvedSecrets.tavilyApiKey = tavilyKey ?? undefined;
  }

  // Create LangSmith client only when not in local-only mode
  const client = options.localOnly
    ? null
    : new Client({
        apiKey: resolvedSecrets.langsmithApiKey,
      });

  // Determine workflows to evaluate
  const workflows: EvalWorkflow[] =
    options.workflow === "all" ? ["productionalize", "planning", "ask"] : [options.workflow];

  const modeLabel = options.localOnly ? "locally" : "with LangSmith";
  logger.progress(`Starting evaluations ${modeLabel} for: ${workflows.join(", ")}`);

  // Run evaluations
  for (const workflow of workflows) {
    await runWorkflowEval(workflow, options, config, resolvedSecrets, client);
  }

  logger.success("All evaluations complete!");
}

export const evalCommand = new Command("eval")
  .description("Run LangSmith evaluations on ShipSpec workflows")
  .addOption(
    new Option("-w, --workflow <type>", "Workflow to evaluate")
      .choices(["productionalize", "planning", "ask", "all"])
      .default("all")
  )
  .option("-d, --dataset <name>", "Dataset name to use (overrides config)")
  .option("--local-only", "Run evaluations locally without uploading to LangSmith")
  .option("--max-concurrency <n>", "Maximum concurrent evaluations (1-10, default: 3)", (val) => {
    const parsed = parseInt(val, 10);
    if (Number.isNaN(parsed)) {
      throw new CliUsageError(`Invalid --max-concurrency value: "${val}" is not a number`);
    }
    if (parsed < 1 || parsed > 10) {
      throw new CliUsageError(
        `Invalid --max-concurrency value: ${String(parsed)} (must be between 1 and 10)`
      );
    }
    return parsed;
  })
  .option("--experiment-prefix <prefix>", "Prefix for experiment name", "shipspec")
  .addOption(new Option("--resolved-config").hideHelp())
  .action(evalAction);
