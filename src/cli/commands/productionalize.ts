import { Command, Option } from "commander";
import { mkdir } from "fs/promises";
import { resolve, join } from "path";
import { existsSync } from "fs";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { format } from "date-fns";
import { input, select, checkbox } from "@inquirer/prompts";
import { Command as LangGraphCommand } from "@langchain/langgraph";

import { loadConfig, type ShipSpecSecrets } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { ensureIndex } from "../../core/indexing/ensure-index.js";
import { createProductionalizeGraph } from "../../agents/productionalize/graph.js";
import type { ProductionalizeStateType } from "../../agents/productionalize/state.js";
import { createCheckpointer } from "../../core/checkpoint/index.js";
import { logger, sanitizeError } from "../../utils/logger.js";
import type {
  ProductionalizeSubtask,
  ProductionalizeInterruptPayload,
  InterviewInterruptPayload,
  WorkerClarificationInterruptPayload,
  ReportReviewInterruptPayload,
} from "../../agents/productionalize/types.js";
import { CliUsageError, CliRuntimeError } from "../errors.js";
import { findProjectRoot, PROJECT_DIR, OUTPUTS_DIR } from "../../core/project/project-state.js";
import { createSecretsStore } from "../../core/secrets/secrets-store.js";
import { redactText } from "../../utils/redaction.js";
import { sanitizeForTerminal } from "../../utils/terminal-sanitize.js";
import { writeFileAtomicNoFollow } from "../../utils/safe-write.js";
import { readdir, unlink } from "fs/promises";
import { readFileSync } from "fs";
import { dirname, basename } from "path";
import { z } from "zod";

interface ProductionalizeOptions {
  enableScans: boolean;
  categories?: string;
  stream: boolean;
  checkpoint: boolean;
  threadId?: string;
  reindex: boolean;
  resolvedConfig?: ShipSpecConfig;
  noSave: boolean;
  keepOutputs?: number; // Optional for defensive programming; default is 10
  cloudOk: boolean;
  localOnly: boolean;
  noInteractive: boolean; // If true, disable interactive mode (default: interactive is ON)
}

/** Result type including possible interrupt */
type ProductionalizeResult = ProductionalizeStateType & {
  __interrupt__?: {
    id: string;
    value: ProductionalizeInterruptPayload;
  }[];
};

async function productionalizeAction(
  context: string | undefined,
  options: ProductionalizeOptions
): Promise<void> {
  // 1. Fail-fast if not initialized
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    throw new CliUsageError("This directory has not been initialized. Run `ship-spec init` first.");
  }

  const { config, secrets: loadedSecrets } = options.resolvedConfig
    ? { config: options.resolvedConfig, secrets: {} as ShipSpecSecrets }
    : await loadConfig(
        projectRoot,
        {},
        {
          verbose: process.argv.includes("--verbose"),
        }
      );

  // 2. Load keys from keychain as fallback (only if not already configured)
  const secretsStore = createSecretsStore(projectRoot);
  const openrouterProviders = ["openrouter"];

  const resolvedSecrets: ShipSpecSecrets = { ...loadedSecrets };

  // For LLM: use existing apiKey from config/env, fallback to keychain
  if (openrouterProviders.includes(config.llm.provider)) {
    if (!resolvedSecrets.llmApiKey) {
      const openrouterKey = await secretsStore.get("OPENROUTER_API_KEY");
      if (!openrouterKey) {
        throw new CliUsageError(
          "OpenRouter API key not found. Run `ship-spec init` or set OPENROUTER_API_KEY."
        );
      }
      resolvedSecrets.llmApiKey = openrouterKey;
    }
  }

  // For embeddings: use existing apiKey from config/env, fallback to keychain
  if (openrouterProviders.includes(config.embedding.provider)) {
    if (!resolvedSecrets.embeddingApiKey) {
      const openrouterKey = await secretsStore.get("OPENROUTER_API_KEY");
      if (!openrouterKey) {
        throw new CliUsageError(
          "OpenRouter API key not found. Run `ship-spec init` or set OPENROUTER_API_KEY."
        );
      }
      resolvedSecrets.embeddingApiKey = openrouterKey;
    }
  }

  // For Tavily: use existing apiKey from config/env, fallback to keychain
  // Load from keychain unless provider is explicitly "duckduckgo" - matches web-search tool behavior
  // which uses Tavily whenever an API key is available and provider !== "duckduckgo"
  if (
    !resolvedSecrets.tavilyApiKey &&
    config.productionalize.webSearch?.provider !== "duckduckgo"
  ) {
    const tavilyKey = await secretsStore.get("TAVILY_API_KEY");
    if (tavilyKey) {
      resolvedSecrets.tavilyApiKey = tavilyKey;
    }
  }

  // 3. Force paths relative to initialized root
  config.projectPath = projectRoot;
  config.vectorDbPath = join(projectRoot, PROJECT_DIR, "lancedb");

  // Override config with CLI options
  if (options.enableScans) {
    const sast = config.productionalize.sast ?? { enabled: false, tools: [] };
    sast.enabled = true;
    if (sast.tools.length === 0) {
      sast.tools = ["semgrep", "gitleaks", "trivy"];
    }
    config.productionalize.sast = sast;
  }

  if (options.categories) {
    config.productionalize.coreCategories = options.categories.split(",").map((c) => c.trim());
  }

  // Interactive mode is enabled by default unless --no-interactive is passed
  const isInteractive = !options.noInteractive;

  // Auto-enable checkpointing for interactive mode (required for interrupt() to work)
  const checkpointEnabled = isInteractive || options.checkpoint || config.checkpoint.enabled;

  if (options.threadId) {
    if (!checkpointEnabled) {
      throw new CliUsageError("--thread-id requires --checkpoint to be enabled");
    }
    // Validate threadId format: allow only [A-Za-z0-9._-]{1,64}
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(options.threadId)) {
      throw new CliUsageError(
        "Invalid --thread-id. Must be 1-64 characters and contain only alphanumeric, '.', '_', or '-'."
      );
    }
  }

  logger.progress(
    `Starting production-readiness analysis...${context ? ` (Context: ${context})` : ""}`
  );

  // 3. LLM Data Sharing Consent
  const cloudProviders = ["openrouter"];
  const isCloudLLM = cloudProviders.includes(config.llm.provider);
  const isCloudEmbedding = cloudProviders.includes(config.embedding.provider);
  // Tavily is used when: provider !== "duckduckgo" AND a Tavily API key is available
  const isCloudSearch =
    config.productionalize.webSearch?.provider !== "duckduckgo" && !!resolvedSecrets.tavilyApiKey;

  if (options.localOnly && (isCloudLLM || isCloudEmbedding || isCloudSearch)) {
    const cloudDeps = [];
    if (isCloudLLM) cloudDeps.push(`LLM (${config.llm.provider})`);
    if (isCloudEmbedding) cloudDeps.push(`Embedding (${config.embedding.provider})`);
    if (isCloudSearch) cloudDeps.push("Web Search (Tavily)");
    throw new CliUsageError(
      `--local-only provided but cloud-based services are configured: ${cloudDeps.join(", ")}. ` +
        "Please use local-only providers (e.g., Ollama) or remove --local-only."
    );
  }

  // Define consent schema for strict validation
  const ConsentSchema = z
    .object({
      cloudOk: z.literal(true),
      timestamp: z.string().optional(),
      version: z.number().int().optional(),
    })
    .strict();

  const consentPath = join(projectRoot, PROJECT_DIR, "consent.json");
  let hasSavedConsent = false;
  if (existsSync(consentPath)) {
    try {
      const consentData: unknown = JSON.parse(readFileSync(consentPath, "utf-8"));
      const parseResult = ConsentSchema.safeParse(consentData);
      if (parseResult.success) {
        hasSavedConsent = true;
      } else {
        logger.warn(
          `Invalid consent file at ${basename(consentPath)}. ` +
            `Please delete it and re-run with --cloud-ok to save fresh consent. ` +
            `Errors: ${parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
        );
      }
    } catch {
      logger.warn(
        `Malformed consent file at ${basename(consentPath)} (invalid JSON). ` +
          `Please delete it and re-run with --cloud-ok.`
      );
    }
  }

  if ((isCloudLLM || isCloudEmbedding || isCloudSearch) && !options.cloudOk && !hasSavedConsent) {
    logger.warn("This command will send data to cloud-based LLM/Search providers.");
    logger.warn("Providers involved:");
    if (isCloudLLM) logger.warn(`- LLM: ${config.llm.provider}`);
    if (isCloudEmbedding) logger.warn(`- Embedding: ${config.embedding.provider}`);
    if (isCloudSearch) logger.warn("- Web Search: Tavily");
    logger.plain("");
    logger.plain("To proceed, you must explicitly acknowledge this data sharing:");
    logger.plain(
      chalk.cyan(`  ship-spec productionalize --cloud-ok`) + " (one-time or to save consent)"
    );
    logger.plain("Or use local-only mode if configured:");
    logger.plain(chalk.cyan(`  ship-spec productionalize --local-only`));
    logger.plain("");
    throw new CliUsageError("Data sharing consent required.");
  }

  // Save consent if --cloud-ok is provided
  if (options.cloudOk && !hasSavedConsent) {
    try {
      await mkdir(dirname(consentPath), { recursive: true, mode: 0o700 });
      await writeFileAtomicNoFollow(
        consentPath,
        JSON.stringify(
          {
            cloudOk: true,
            timestamp: new Date().toISOString(),
            version: 1,
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
      logger.info("Cloud data sharing consent saved to .ship-spec/consent.json");
    } catch (err) {
      logger.warn(`Failed to save consent: ${sanitizeError(err)}`);
    }
  }

  logger.progress("Initializing vector store...");
  const vectorStore = new LanceDBManager(resolve(config.vectorDbPath));

  // Step 4: Resolve embedding dimensions (avoid mutating global config)
  let resolvedDimensions: number;
  if (config.embedding.dimensions === "auto") {
    logger.progress("Probing embedding dimensions...");
    const probeEmbeddings = await createEmbeddingsModel(
      config.embedding,
      resolvedSecrets.embeddingApiKey
    );
    const probeVector = await probeEmbeddings.embedQuery("dimension probe");
    resolvedDimensions = probeVector.length;
    logger.info(`Detected embedding dimensions: ${String(resolvedDimensions)}`);
  } else {
    resolvedDimensions = config.embedding.dimensions;
  }

  // Create a scoped config with resolved dimensions for indexing
  const resolvedEmbeddingConfig = { ...config.embedding, dimensions: resolvedDimensions };
  const resolvedConfig = { ...config, embedding: resolvedEmbeddingConfig };

  const embeddings = await createEmbeddingsModel(config.embedding, resolvedSecrets.embeddingApiKey);
  const repository = new DocumentRepository(vectorStore, embeddings, resolvedDimensions);

  const manifestPath = join(resolve(config.vectorDbPath), "index-manifest");
  logger.progress("Checking codebase index freshness...");
  try {
    const indexResult = await ensureIndex({
      config: resolvedConfig,
      repository,
      vectorStore,
      manifestPath,
      forceReindex: options.reindex,
    });

    if (indexResult.added > 0 || indexResult.modified > 0 || indexResult.removed > 0) {
      logger.info(
        `Index updated: ${String(indexResult.added)} added, ${String(
          indexResult.modified
        )} modified, ${String(indexResult.removed)} removed`
      );
    } else {
      logger.info("Index is up to date.");
    }
  } catch (err) {
    throw new CliRuntimeError("Indexing failed", err);
  }

  let checkpointer;
  if (checkpointEnabled) {
    try {
      logger.progress("Initializing checkpointer...");
      checkpointer = createCheckpointer(config.checkpoint.type, config.checkpoint.sqlitePath);
    } catch (err) {
      throw new CliRuntimeError("Failed to initialize checkpointer", err);
    }
  }

  logger.progress("Initializing productionalize workflow...");
  const graph = await createProductionalizeGraph(config, repository, {
    checkpointer,
    llmApiKey: resolvedSecrets.llmApiKey,
    searchApiKey: resolvedSecrets.tavilyApiKey,
    shouldRedactCloud: isCloudLLM, // Redact if using a cloud LLM
  });

  let finalReport = "";
  let finalTaskPrompts = "";

  const graphConfig = checkpointEnabled
    ? {
        configurable: {
          thread_id: options.threadId ?? randomUUID(),
        },
      }
    : {};

  // Initial state for the graph
  const initialState = {
    userQuery: context ?? "Perform a full production-readiness analysis of this codebase.",
    interactiveMode: isInteractive,
  };

  if (isInteractive) {
    // Interactive mode: use invoke with interrupt handling loop
    logger.progress("Starting interactive analysis pipeline...\n");

    try {
      let result = (await graph.invoke(initialState, graphConfig)) as ProductionalizeResult;

      // Handle interrupts in a loop
      while (result.__interrupt__ && result.__interrupt__.length > 0) {
        const interruptObj = result.__interrupt__[0];
        if (!interruptObj) break;

        const interruptValue = interruptObj.value;

        switch (interruptValue.type) {
          case "interview":
            result = await handleInterviewInterrupt(graph, graphConfig, interruptValue);
            break;
          case "worker_clarification":
            result = await handleWorkerClarificationInterrupt(graph, graphConfig, interruptValue);
            break;
          case "report_review":
            result = await handleReportReviewInterrupt(graph, graphConfig, interruptValue);
            break;
          default: {
            // TypeScript exhaustiveness check - this should never be reached
            // if all ProductionalizeInterruptPayload types are handled above.
            // At runtime, throw to prevent infinite loop from unhandled interrupt type.
            const unknownType = (interruptValue as { type: string }).type;
            throw new CliRuntimeError(
              `Unhandled interrupt type: "${unknownType}". ` +
                "This may indicate a version mismatch or corrupted state."
            );
          }
        }
      }

      finalReport = result.finalReport;
      finalTaskPrompts = result.taskPrompts;
    } catch (err) {
      throw new CliRuntimeError("Analysis failed", err);
    }
  } else if (options.stream) {
    // Non-interactive streaming mode
    logger.progress("Starting analysis pipeline (non-interactive)...\n");

    try {
      const stream = await graph.stream(initialState, { streamMode: "updates", ...graphConfig });

      for await (const event of stream) {
        if (event.gatherSignals) {
          logger.progress(chalk.cyan("[Signals] Project signals gathered."));
        }
        if (event.researcher) {
          logger.progress(chalk.cyan("[Researcher] Compliance standards digest created."));
        }
        if (event.scanner) {
          logger.progress(chalk.cyan("[Scanner] SAST scans completed."));
        }
        if (event.planner?.subtasks) {
          const subtasks = event.planner.subtasks as ProductionalizeSubtask[];
          logger.progress(`[Planner] Generated ${String(subtasks.length)} analysis subtasks:`);
          subtasks.forEach((task, i: number) => {
            logger.progress(`  ${String(i + 1)}. [${task.source}] ${task.category}: ${task.query}`);
          });
          logger.progress("");
        }

        if (event.worker?.subtasks) {
          const subtasks = event.worker.subtasks as ProductionalizeSubtask[];
          const completedTask = subtasks.find((t) => t.status === "complete");
          if (completedTask) {
            logger.progress(chalk.yellow(`[Worker] Completed: ${completedTask.category}`));
          }
        }

        const eventData = event as Record<string, unknown>;
        const aggregator = eventData.aggregator as { finalReport?: string } | undefined;
        if (aggregator?.finalReport) {
          finalReport = aggregator.finalReport;
          logger.progress(chalk.green("\n[Aggregator] Production Readiness Report generated!"));
        }

        const promptGenerator = eventData.promptGenerator as { taskPrompts?: string } | undefined;
        if (promptGenerator?.taskPrompts) {
          finalTaskPrompts = promptGenerator.taskPrompts;
          logger.progress(chalk.green("[PromptGenerator] Agent-ready task prompts generated!\n"));
        }
      }
    } catch (err) {
      throw new CliRuntimeError("Analysis failed", err);
    }
  } else {
    // Non-interactive batch mode
    try {
      const result = (await graph.invoke(initialState, graphConfig)) as ProductionalizeResult;
      finalReport = result.finalReport;
      finalTaskPrompts = result.taskPrompts;
    } catch (err) {
      throw new CliRuntimeError("Analysis failed", err);
    }
  }

  // 4. Handle outputs
  if (options.noSave) {
    logger.info("Skipping saving outputs (--no-save enabled).");
    logger.output(sanitizeForTerminal(redactText(finalReport)));
    logger.output("\n---\n");
    logger.output(sanitizeForTerminal(redactText(finalTaskPrompts)));
    return;
  }

  const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
  const outputsDir = join(projectRoot, PROJECT_DIR, OUTPUTS_DIR);

  const reportPath = join(outputsDir, `report-${timestamp}.md`);
  const promptsPath = join(outputsDir, `task-prompts-${timestamp}.md`);

  try {
    if (!existsSync(outputsDir)) {
      await mkdir(outputsDir, { recursive: true, mode: 0o700 });
    }

    // Add security warning banner to markdown files
    const UNTRUSTED_BANNER =
      `<!-- ⚠️ GENERATED FILE: UNTRUSTED CONTENT -->\n` +
      `<!-- This file contains AI-generated content. Review carefully before clicking links. -->\n\n` +
      `> **⚠️ SECURITY NOTICE**\n` +
      `> This is an AI-generated report. Review all links and recommendations before use.\n\n`;

    const redactedReport = UNTRUSTED_BANNER + redactText(finalReport);
    const redactedPrompts = UNTRUSTED_BANNER + redactText(finalTaskPrompts);

    await writeFileAtomicNoFollow(reportPath, redactedReport, { mode: 0o600 });
    await writeFileAtomicNoFollow(promptsPath, redactedPrompts, { mode: 0o600 });

    // Update latest pointers
    const latestReportPath = join(projectRoot, PROJECT_DIR, "latest-report.md");
    const latestPromptsPath = join(projectRoot, PROJECT_DIR, "latest-task-prompts.md");

    await writeFileAtomicNoFollow(latestReportPath, redactedReport, { mode: 0o600 });
    await writeFileAtomicNoFollow(latestPromptsPath, redactedPrompts, { mode: 0o600 });

    logger.success(`Report written to: ${chalk.cyan(reportPath)}`);
    logger.success(`Task prompts written to: ${chalk.cyan(promptsPath)}`);

    // 5. Prune old outputs
    await pruneOutputs(outputsDir, options.keepOutputs ?? 10);
  } catch (err) {
    throw new CliRuntimeError("Failed to write output files.", err);
  }
}

/**
 * Prunes old output files beyond the specified retention limit.
 * @param outputsDir - Directory containing output files
 * @param limit - Number of outputs to keep (must be >= 1)
 */
async function pruneOutputs(outputsDir: string, limit: number): Promise<void> {
  // Defense-in-depth: guard against invalid limits that would delete all files
  // Note: typeof check catches undefined, isNaN catches NaN from coercion
  if (typeof limit !== "number" || Number.isNaN(limit) || limit < 1) {
    logger.warn(`Invalid keep-outputs limit (${String(limit)}), skipping pruning`);
    return;
  }

  try {
    const files = await readdir(outputsDir);
    const reports = files
      .filter((f) => f.startsWith("report-") && f.endsWith(".md"))
      .sort()
      .reverse();
    const prompts = files
      .filter((f) => f.startsWith("task-prompts-") && f.endsWith(".md"))
      .sort()
      .reverse();

    if (reports.length > limit) {
      for (const file of reports.slice(limit)) {
        await unlink(join(outputsDir, file));
      }
    }
    if (prompts.length > limit) {
      for (const file of prompts.slice(limit)) {
        await unlink(join(outputsDir, file));
      }
    }
  } catch (err) {
    logger.warn(`Failed to prune old outputs: ${sanitizeError(err)}`);
  }
}

// ============================================================================
// Interrupt Handlers
// ============================================================================

/**
 * Handles interview interrupt - prompts user with clarifying questions.
 */
async function handleInterviewInterrupt(
  graph: Awaited<ReturnType<typeof createProductionalizeGraph>>,
  graphConfig: { configurable?: { thread_id: string } },
  interruptPayload: InterviewInterruptPayload
): Promise<ProductionalizeResult> {
  logger.plain(chalk.yellow("\n📋 Before we begin, a few questions:\n"));

  const answers: Record<string, string | string[]> = {};

  for (const question of interruptPayload.questions) {
    if (question.type === "select" && question.options && question.options.length > 0) {
      const answer = await select({
        message: question.question,
        choices: question.options.map((opt) => ({ value: opt, name: opt })),
      });
      answers[question.id] = answer;
    } else if (question.type === "multiselect" && question.options && question.options.length > 0) {
      const answer = await checkbox({
        message: question.question,
        choices: question.options.map((opt) => ({ value: opt, name: opt })),
      });
      answers[question.id] = answer;
    } else {
      // text type
      const answer = await input({
        message: question.question,
      });
      answers[question.id] = answer;
    }
  }

  logger.plain("");

  return graph.invoke(
    new LangGraphCommand({ resume: answers }),
    graphConfig
  ) as Promise<ProductionalizeResult>;
}

/**
 * Handles worker clarification interrupt - shows context and prompts for clarification.
 *
 * NOTE: This handler is currently UNUSED because workers don't call interrupt().
 * Workers run in parallel via Send(), which makes interrupt() unsuitable:
 * - Multiple workers calling interrupt() simultaneously causes routing issues
 * - State fields use last-write-wins reducers, so concurrent updates clobber each other
 * - There's no loop-back edge to handle worker clarification interrupts
 *
 * The handler is kept in place for potential future use if a different architecture
 * (e.g., sequential workers, batched clarification collection) is implemented.
 */
async function handleWorkerClarificationInterrupt(
  graph: Awaited<ReturnType<typeof createProductionalizeGraph>>,
  graphConfig: { configurable?: { thread_id: string } },
  interruptPayload: WorkerClarificationInterruptPayload
): Promise<ProductionalizeResult> {
  logger.plain(chalk.yellow(`\n🔍 Clarification needed for [${interruptPayload.category}]:\n`));
  logger.plain(chalk.dim(`Context: ${interruptPayload.findingContext}\n`));

  const answers: Record<string, string> = {};

  for (const [i, question] of interruptPayload.questions.entries()) {
    const answer = await input({
      message: `${String(i + 1)}. ${question}`,
    });
    answers[String(i)] = answer;
  }

  logger.plain("");

  return graph.invoke(
    new LangGraphCommand({ resume: answers }),
    graphConfig
  ) as Promise<ProductionalizeResult>;
}

/**
 * Handles report review interrupt - displays report and prompts for approval/feedback.
 */
async function handleReportReviewInterrupt(
  graph: Awaited<ReturnType<typeof createProductionalizeGraph>>,
  graphConfig: { configurable?: { thread_id: string } },
  interruptPayload: ReportReviewInterruptPayload
): Promise<ProductionalizeResult> {
  logger.success(chalk.green("\n📄 Production Readiness Report:\n"));
  logger.output(sanitizeForTerminal(redactText(interruptPayload.report)));
  logger.plain("");

  const feedback = await input({
    message:
      chalk.cyan("Review the report above.") +
      chalk.dim("\n(Type 'approve' to proceed, or provide feedback for revisions): "),
  });

  return graph.invoke(
    new LangGraphCommand({ resume: feedback }),
    graphConfig
  ) as Promise<ProductionalizeResult>;
}

export const productionalizeCommand = new Command("productionalize")
  .description("Analyze codebase for production readiness and generate agent-ready task prompts")
  .argument("[context]", "Optional context (e.g., 'B2B SaaS handling PII')")
  .option("--enable-scans", "Run SAST scanners if available")
  .option("--categories <list>", "Filter to specific categories (comma-separated)")
  .option("--no-stream", "Disable streaming progress output")
  .option("--reindex", "Force full re-index of the codebase")
  .option("--checkpoint", "Enable checkpointing for state persistence")
  .option("--thread-id <id>", "Thread ID for resuming a session")
  .option("--no-save", "Do not save reports to disk, only print to stdout")
  .option(
    "--keep-outputs <number>",
    "Number of historical outputs to keep (minimum: 1)",
    (val) => {
      const parsed = parseInt(val, 10);
      if (Number.isNaN(parsed)) {
        throw new CliUsageError(`--keep-outputs must be a valid number, got: "${val}"`);
      }
      if (parsed < 1) {
        throw new CliUsageError(`--keep-outputs must be at least 1, got: ${String(parsed)}`);
      }
      return parsed;
    },
    10
  )
  .option(
    "--no-interactive",
    "Disable interactive mode (skip clarification questions and report review)"
  )
  .option("--cloud-ok", "Acknowledge and consent to sending data to cloud LLM/Search providers")
  .option("--local-only", "Strictly refuse to use cloud-based providers")
  .addOption(new Option("--resolved-config").hideHelp())
  .action(productionalizeAction);
