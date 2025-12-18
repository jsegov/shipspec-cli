import { Command, Option } from "commander";
import { writeFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";

import { loadConfig } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { createSpecGraph } from "../../agents/graph.js";
import { createCheckpointer } from "../../core/checkpoint/index.js";
import { logger } from "../../utils/logger.js";

interface SpecOptions {
  output?: string;
  stream: boolean;
  checkpoint: boolean;
  threadId?: string;
  resolvedConfig?: ShipSpecConfig;
}

async function specAction(prompt: string, options: SpecOptions): Promise<void> {
  const config = options.resolvedConfig || (await loadConfig(process.cwd()));

  const checkpointEnabled = options.checkpoint || config.checkpoint.enabled;

  if (options.threadId && !checkpointEnabled) {
    logger.error("--thread-id requires --checkpoint to be enabled");
    process.exit(1);
  }

  logger.progress(`Generating specification for: "${prompt}"`);

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

  logger.progress("Initializing analysis workflow...");
  const graph = await createSpecGraph(config, repository, { checkpointer });

  let finalSpec = "";

  const graphConfig = checkpointEnabled
    ? {
        configurable: {
          thread_id: options.threadId || `session-${Date.now()}`,
        },
      }
    : {};

  if (options.stream) {
    logger.progress("Starting analysis...\n");

    try {
      const stream = await graph.stream(
        { userQuery: prompt },
        { streamMode: "updates", ...graphConfig }
      );

      for await (const event of stream) {
        if (event.planner) {
          const subtasks = event.planner.subtasks || [];
          console.error(
            chalk.cyan(`[Planner] Decomposed query into ${subtasks.length} subtasks:`)
          );
          subtasks.forEach((task: { query: string }, i: number) => {
            console.error(chalk.cyan(`  ${i + 1}. ${task.query}`));
          });
          console.error();
        }

        if (event.worker) {
          const subtasks = event.worker.subtasks || [];
          const completedTask = subtasks.find(
            (t: { status: string }) => t.status === "complete"
          );
          if (completedTask) {
            console.error(
              chalk.yellow(`[Worker] Completed: ${completedTask.query}`)
            );
          }
        }

        if (event.aggregator?.finalSpec) {
          finalSpec = event.aggregator.finalSpec;
          console.error(chalk.green("\n[Aggregator] Specification generated!\n"));
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Analysis failed: ${errorMsg}`);

      if (errorMsg.includes("API key")) {
        logger.info(
          "Make sure your API key is set in .env or environment variables."
        );
      } else if (errorMsg.includes("ECONNREFUSED")) {
        logger.info(
          "If using Ollama, make sure the Ollama server is running."
        );
      }

      process.exit(1);
    }
  } else {
    try {
      const result = await graph.invoke({ userQuery: prompt }, graphConfig);
      finalSpec = result.finalSpec || "";
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Analysis failed: ${errorMsg}`);
      process.exit(1);
    }
  }

  if (!finalSpec) {
    logger.error("No specification was generated.");
    process.exit(1);
  }

  if (options.output) {
    const outputPath = resolve(options.output);
    await writeFile(outputPath, finalSpec, "utf-8");
    logger.success(`Specification written to: ${outputPath}`);
  } else {
    console.log(finalSpec);
  }
}

export const specCommand = new Command("spec")
  .description("Generate a specification based on a prompt")
  .addOption(new Option("--resolved-config").hideHelp())
  .argument("<prompt>", "The analysis prompt describing what to analyze")
  .option(
    "-o, --output <file>",
    "Write specification to file instead of stdout"
  )
  .option(
    "--no-stream",
    "Disable streaming progress output"
  )
  .option(
    "--checkpoint",
    "Enable checkpointing for state persistence"
  )
  .option(
    "--thread-id <id>",
    "Thread ID for resuming a session (requires --checkpoint; auto-generated if not provided)"
  )
  .action(specAction);
