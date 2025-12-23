import { Command, Option } from "commander";
import { mkdir } from "fs/promises";
import { resolve, join } from "path";
import { existsSync } from "fs";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { format } from "date-fns";

import { loadConfig, type ShipSpecSecrets } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { ensureIndex } from "../../core/indexing/ensure-index.js";
import { createProductionalizeGraph } from "../../agents/productionalize/graph.js";
import { ProductionalizeStateType } from "../../agents/productionalize/state.js";
import { createCheckpointer } from "../../core/checkpoint/index.js";
import { logger, sanitizeError } from "../../utils/logger.js";
import type { ProductionalizeSubtask } from "../../agents/productionalize/types.js";
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
}

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
  const openaiProviders = ["openai", "azure-openai"];

  const resolvedSecrets: ShipSpecSecrets = { ...loadedSecrets };

  // For LLM: use existing apiKey from config/env, fallback to keychain
  if (openaiProviders.includes(config.llm.provider)) {
    if (!resolvedSecrets.llmApiKey) {
      const openaiKey = await secretsStore.get("OPENAI_API_KEY");
      if (!openaiKey) {
        throw new CliUsageError(
          "OpenAI API key not found. Run `ship-spec init` or set OPENAI_API_KEY."
        );
      }
      resolvedSecrets.llmApiKey = openaiKey;
    }
  }

  // For embeddings: use existing apiKey from config/env, fallback to keychain
  if (openaiProviders.includes(config.embedding.provider)) {
    if (!resolvedSecrets.embeddingApiKey) {
      const openaiKey = await secretsStore.get("OPENAI_API_KEY");
      if (!openaiKey) {
        throw new CliUsageError(
          "OpenAI API key not found. Run `ship-spec init` or set OPENAI_API_KEY."
        );
      }
      resolvedSecrets.embeddingApiKey = openaiKey;
    }
  }

  // For Tavily: use existing apiKey from config/env, fallback to keychain
  if (!resolvedSecrets.tavilyApiKey && config.productionalize.webSearch?.provider === "tavily") {
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

  const checkpointEnabled = options.checkpoint || config.checkpoint.enabled;

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
  const cloudProviders = ["openai", "anthropic", "google-vertexai", "mistralai", "azure-openai"];
  const isCloudLLM = cloudProviders.includes(config.llm.provider);
  const isCloudEmbedding = cloudProviders.includes(config.embedding.provider);
  const isCloudSearch = config.productionalize.webSearch?.provider === "tavily";

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
  const embeddings = await createEmbeddingsModel(config.embedding, resolvedSecrets.embeddingApiKey);
  const repository = new DocumentRepository(vectorStore, embeddings, config.embedding.dimensions);

  const manifestPath = join(resolve(config.vectorDbPath), "index-manifest");
  logger.progress("Checking codebase index freshness...");
  try {
    const indexResult = await ensureIndex({
      config,
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

  if (options.stream) {
    logger.progress("Starting analysis pipeline...\n");

    try {
      const stream = await graph.stream(
        { userQuery: context ?? "Perform a full production-readiness analysis of this codebase." },
        { streamMode: "updates", ...graphConfig }
      );

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
    try {
      const result = (await graph.invoke(
        { userQuery: context ?? "Perform a full production-readiness analysis of this codebase." },
        graphConfig
      )) as Partial<ProductionalizeStateType>;
      finalReport = result.finalReport ?? "";
      finalTaskPrompts = result.taskPrompts ?? "";
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
  .option("--cloud-ok", "Acknowledge and consent to sending data to cloud LLM/Search providers")
  .option("--local-only", "Strictly refuse to use cloud-based providers")
  .addOption(new Option("--resolved-config").hideHelp())
  .action(productionalizeAction);
