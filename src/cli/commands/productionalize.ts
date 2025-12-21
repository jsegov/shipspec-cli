import { Command, Option } from "commander";
import { writeFile } from "fs/promises";
import { resolve, join } from "path";
import { randomUUID } from "node:crypto";
import chalk from "chalk";

import { loadConfig } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { ensureIndex } from "../../core/indexing/ensure-index.js";
import { createProductionalizeGraph } from "../../agents/productionalize/graph.js";
import { createCheckpointer } from "../../core/checkpoint/index.js";
import { logger } from "../../utils/logger.js";
import type { ProductionalizeSubtask, TaskmasterTask } from "../../agents/productionalize/types.js";
import { CliUsageError, CliRuntimeError } from "../errors.js";

interface ProductionalizeOptions {
  output?: string;
  tasksOutput?: string;
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
  const config = options.resolvedConfig ?? (await loadConfig(process.cwd()));

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
  const embeddings = createEmbeddingsModel(config.embedding);
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
  } catch (error) {
    throw new CliRuntimeError("Indexing failed", error);
  }

  let checkpointer;
  if (checkpointEnabled) {
    try {
      logger.progress("Initializing checkpointer...");
      checkpointer = createCheckpointer(config.checkpoint.type, config.checkpoint.sqlitePath);
    } catch (error) {
      throw new CliRuntimeError("Failed to initialize checkpointer", error);
    }
  }

  logger.progress("Initializing productionalize workflow...");
  const graph = await createProductionalizeGraph(config, repository, { checkpointer });

  let finalReport = "";
  let finalTasks: TaskmasterTask[] = [];

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

        if (event.taskGenerator?.tasks) {
          finalTasks = event.taskGenerator.tasks;
          logger.progress(chalk.green("[TaskGenerator] Agent-executable tasks generated!\n"));
        }
      }
    } catch (error) {
      throw new CliRuntimeError("Analysis failed", error);
    }
  } else {
    try {
      const result = await graph.invoke(
        { userQuery: context ?? "Perform a full production-readiness analysis of this codebase." },
        graphConfig
      );
      finalReport = result.finalReport;
      finalTasks = result.tasks;
    } catch (error) {
      throw new CliRuntimeError("Analysis failed", error);
    }
  }

  if (options.output) {
    const outputPath = resolve(options.output);
    try {
      await writeFile(outputPath, finalReport, "utf-8");
      logger.success(`Report written to: ${outputPath}`);
    } catch (error) {
      throw new CliRuntimeError(`Failed to write report to: ${outputPath}`, error);
    }
  } else {
    logger.output(finalReport);
  }

  if (options.tasksOutput) {
    const tasksPath = resolve(options.tasksOutput);
    try {
      await writeFile(tasksPath, JSON.stringify(finalTasks, null, 2), "utf-8");
      logger.success(`Tasks written to: ${tasksPath}`);
    } catch (error) {
      throw new CliRuntimeError(`Failed to write tasks to: ${tasksPath}`, error);
    }
  } else {
    if (finalTasks.length > 0 && !options.output) {
      logger.plain(chalk.bold("\n--- Agent Task List ---"));
      logger.plain(JSON.stringify(finalTasks, null, 2));
    }
  }
}

export const productionalizeCommand = new Command("productionalize")
  .description("Analyze codebase for production readiness and generate task list")
  .argument("[context]", "Optional context (e.g., 'B2B SaaS handling PII')")
  .option("-o, --output <file>", "Write report to file")
  .option("--tasks-output <file>", "Write tasks JSON to file")
  .option("--enable-scans", "Run SAST scanners if available")
  .option("--categories <list>", "Filter to specific categories (comma-separated)")
  .option("--no-stream", "Disable streaming progress output")
  .option("--reindex", "Force full re-index of the codebase")
  .option("--checkpoint", "Enable checkpointing for state persistence")
  .option("--thread-id <id>", "Thread ID for resuming a session")
  .addOption(new Option("--resolved-config").hideHelp())
  .action(productionalizeAction);
