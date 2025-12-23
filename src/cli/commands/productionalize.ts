import { Command, Option } from "commander";
import { writeFile, copyFile, mkdir } from "fs/promises";
import { resolve, join } from "path";
import { existsSync } from "fs";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { format } from "date-fns";

import { loadConfig } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { ensureIndex } from "../../core/indexing/ensure-index.js";
import { createProductionalizeGraph } from "../../agents/productionalize/graph.js";
import { createCheckpointer } from "../../core/checkpoint/index.js";
import { logger } from "../../utils/logger.js";
import type { ProductionalizeSubtask } from "../../agents/productionalize/types.js";
import { CliUsageError, CliRuntimeError } from "../errors.js";
import { findProjectRoot, PROJECT_DIR, OUTPUTS_DIR } from "../../core/project/project-state.js";
import { createSecretsStore } from "../../core/secrets/secrets-store.js";

interface ProductionalizeOptions {
  enableScans: boolean;
  categories?: string;
  stream: boolean;
  checkpoint: boolean;
  threadId?: string;
  reindex: boolean;
  resolvedConfig?: ShipSpecConfig;
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

  const config = options.resolvedConfig ?? (await loadConfig(projectRoot));

  // 2. Load keys from keychain as fallback (only if not already configured)
  const secretsStore = createSecretsStore();
  const openaiProviders = ["openai", "azure-openai"];

  // For LLM: use existing apiKey from config/env, fallback to keychain
  if (openaiProviders.includes(config.llm.provider)) {
    if (!config.llm.apiKey) {
      const openaiKey = await secretsStore.get("OPENAI_API_KEY");
      if (!openaiKey) {
        throw new CliUsageError(
          "OpenAI API key not found. Run `ship-spec init` or set OPENAI_API_KEY."
        );
      }
      config.llm.apiKey = openaiKey;
    }
  }

  // For embeddings: use existing apiKey from config/env, fallback to keychain
  if (openaiProviders.includes(config.embedding.provider)) {
    if (!config.embedding.apiKey) {
      const openaiKey = await secretsStore.get("OPENAI_API_KEY");
      if (!openaiKey) {
        throw new CliUsageError(
          "OpenAI API key not found. Run `ship-spec init` or set OPENAI_API_KEY."
        );
      }
      config.embedding.apiKey = openaiKey;
    }
  }

  // For Tavily: use existing apiKey from config/env, fallback to keychain
  const existingWebSearchKey = config.productionalize.webSearch?.apiKey;
  const existingProvider = config.productionalize.webSearch?.provider;
  if (!existingWebSearchKey && (!existingProvider || existingProvider === "tavily")) {
    const tavilyKey = await secretsStore.get("TAVILY_API_KEY");
    if (tavilyKey) {
      config.productionalize.webSearch = { provider: "tavily", apiKey: tavilyKey };
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

  logger.progress("Initializing vector store...");
  const vectorStore = new LanceDBManager(resolve(config.vectorDbPath));
  const embeddings = await createEmbeddingsModel(config.embedding);
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

        if (event.aggregator?.finalReport) {
          finalReport = event.aggregator.finalReport;
          logger.progress(chalk.green("\n[Aggregator] Production Readiness Report generated!"));
        }

        if (event.promptGenerator?.taskPrompts) {
          finalTaskPrompts = event.promptGenerator.taskPrompts;
          logger.progress(chalk.green("[PromptGenerator] Agent-ready task prompts generated!\n"));
        }
      }
    } catch (err) {
      throw new CliRuntimeError("Analysis failed", err);
    }
  } else {
    try {
      const result = await graph.invoke(
        { userQuery: context ?? "Perform a full production-readiness analysis of this codebase." },
        graphConfig
      );
      finalReport = result.finalReport;
      finalTaskPrompts = result.taskPrompts;
    } catch (err) {
      throw new CliRuntimeError("Analysis failed", err);
    }
  }

  // 4. Always write to .ship-spec/outputs/
  const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
  const outputsDir = join(projectRoot, PROJECT_DIR, OUTPUTS_DIR);

  const reportPath = join(outputsDir, `report-${timestamp}.md`);
  const promptsPath = join(outputsDir, `task-prompts-${timestamp}.md`);

  try {
    if (!existsSync(outputsDir)) {
      await mkdir(outputsDir, { recursive: true });
    }
    await writeFile(reportPath, finalReport, "utf-8");
    await writeFile(promptsPath, finalTaskPrompts, "utf-8");

    // Update latest pointers
    await copyFile(reportPath, join(projectRoot, PROJECT_DIR, "latest-report.md"));
    await copyFile(promptsPath, join(projectRoot, PROJECT_DIR, "latest-task-prompts.md"));

    logger.success(`Report written to: ${chalk.cyan(reportPath)}`);
    logger.success(`Task prompts written to: ${chalk.cyan(promptsPath)}`);
  } catch (err) {
    throw new CliRuntimeError("Failed to write output files.", err);
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
  .addOption(new Option("--resolved-config").hideHelp())
  .action(productionalizeAction);
