import { Command, Option } from "commander";
import { writeFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";

import { loadConfig } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { createProductionalizeGraph } from "../../agents/productionalize/graph.js";
import { createCheckpointer } from "../../core/checkpoint/index.js";
import { logger } from "../../utils/logger.js";
import type { ProductionalizeSubtask, TaskmasterTask } from "../../agents/productionalize/state.js";

interface ProductionalizeOptions {
  output?: string;
  tasksOutput?: string;
  enableScans: boolean;
  categories?: string;
  stream: boolean;
  checkpoint: boolean;
  threadId?: string;
  resolvedConfig?: ShipSpecConfig;
}

async function productionalizeAction(context: string | undefined, options: ProductionalizeOptions): Promise<void> {
  const config = options.resolvedConfig || (await loadConfig(process.cwd()));

  // Override config with CLI options
  if (options.enableScans) {
    config.productionalize = config.productionalize || {};
    config.productionalize.sast = config.productionalize.sast || { enabled: false, tools: [] };
    config.productionalize.sast.enabled = true;
    if (!config.productionalize.sast.tools || config.productionalize.sast.tools.length === 0) {
      config.productionalize.sast.tools = ["semgrep", "gitleaks", "trivy"];
    }
  }
  
  if (options.categories) {
    config.productionalize = config.productionalize || {};
    config.productionalize.coreCategories = options.categories.split(",").map(c => c.trim());
  }

  const checkpointEnabled = options.checkpoint || config.checkpoint.enabled;

  if (options.threadId && !checkpointEnabled) {
    logger.error("--thread-id requires --checkpoint to be enabled");
    process.exit(1);
  }

  logger.progress(`Starting production-readiness analysis...${context ? ` (Context: ${context})` : ""}`);

  logger.progress("Initializing vector store...");
  const vectorStore = new LanceDBManager(resolve(config.vectorDbPath));
  const embeddings = await createEmbeddingsModel(config.embedding);
  const repository = new DocumentRepository(
    vectorStore,
    embeddings,
    config.embedding.dimensions
  );

  let checkpointer;
  if (checkpointEnabled) {
    try {
      logger.progress("Initializing checkpointer...");
      checkpointer = await createCheckpointer(
        config.checkpoint.type,
        config.checkpoint.sqlitePath
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to initialize checkpointer: ${errorMsg}`);
      process.exit(1);
    }
  }

  logger.progress("Initializing productionalize workflow...");
  const graph = await createProductionalizeGraph(config, repository, { checkpointer });

  let finalReport = "";
  let finalTasks: TaskmasterTask[] = [];

  const graphConfig = checkpointEnabled
    ? {
        configurable: {
          thread_id: options.threadId || `session-${Date.now()}`,
        },
      }
    : {};

  if (options.stream) {
    logger.progress("Starting analysis pipeline...\n");

    try {
      const stream = await graph.stream(
        { userQuery: context || "Perform a full production-readiness analysis of this codebase." },
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
        if (event.planner) {
          const subtasks = (event.planner.subtasks || []) as ProductionalizeSubtask[];
          console.error(chalk.cyan(`[Planner] Generated ${subtasks.length} analysis subtasks:`));
          subtasks.forEach((task, i: number) => {
            console.error(chalk.cyan(`  ${i + 1}. [${task.source}] ${task.category}: ${task.query}`));
          });
          console.error();
        }

        if (event.worker) {
          const subtasks = (event.worker.subtasks || []) as ProductionalizeSubtask[];
          const completedTask = subtasks.find((t) => t.status === "complete");
          if (completedTask) {
            console.error(chalk.yellow(`[Worker] Completed: ${completedTask.category}`));
          }
        }

        if (event.aggregator?.finalReport) {
          finalReport = event.aggregator.finalReport;
          console.error(chalk.green("\n[Aggregator] Production Readiness Report generated!"));
        }

        if (event.taskGenerator?.tasks) {
          finalTasks = event.taskGenerator.tasks;
          console.error(chalk.green("[TaskGenerator] Agent-executable tasks generated!\n"));
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Analysis failed: ${errorMsg}`);
      process.exit(1);
    }
  } else {
    try {
      const result = await graph.invoke(
        { userQuery: context || "Perform a full production-readiness analysis of this codebase." },
        graphConfig
      );
      finalReport = result.finalReport || "";
      finalTasks = result.tasks || [];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Analysis failed: ${errorMsg}`);
      process.exit(1);
    }
  }

  if (options.output) {
    const outputPath = resolve(options.output);
    await writeFile(outputPath, finalReport, "utf-8");
    logger.success(`Report written to: ${outputPath}`);
  } else if (!options.tasksOutput) {
    console.log(finalReport);
  }

  if (options.tasksOutput) {
    const tasksPath = resolve(options.tasksOutput);
    await writeFile(tasksPath, JSON.stringify(finalTasks, null, 2), "utf-8");
    logger.success(`Tasks written to: ${tasksPath}`);
  } else {
    if (finalTasks.length > 0 && !options.output) {
      console.log(chalk.bold("\n--- Agent Task List ---"));
      console.log(JSON.stringify(finalTasks, null, 2));
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
  .option("--checkpoint", "Enable checkpointing for state persistence")
  .option("--thread-id <id>", "Thread ID for resuming a session")
  .addOption(new Option("--resolved-config").hideHelp())
  .action(productionalizeAction);
