import { Command } from "commander";
import { writeFile } from "fs/promises";
import { resolve } from "path";
import chalk from "chalk";

import { loadConfig } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { createSpecGraph } from "../../agents/graph.js";
import { logger } from "../../utils/logger.js";

interface SpecOptions {
  output?: string;
  stream: boolean;
  resolvedConfig?: ShipSpecConfig;
}

async function specAction(prompt: string, options: SpecOptions): Promise<void> {
  const config = options.resolvedConfig || (await loadConfig(process.cwd()));

  logger.progress(`Generating specification for: "${prompt}"`);

  // Initialize repository
  logger.progress("Initializing vector store...");
  const vectorStore = new LanceDBManager(resolve(config.vectorDbPath));
  const embeddings = await createEmbeddingsModel(config.embedding);
  const repository = new DocumentRepository(
    vectorStore,
    embeddings,
    config.embedding.dimensions
  );

  // Create the graph
  logger.progress("Initializing analysis workflow...");
  const graph = await createSpecGraph(config, repository);

  let finalSpec = "";

  if (options.stream) {
    // Streaming mode - show progress as the graph executes
    logger.progress("Starting analysis...\n");

    try {
      for await (const event of graph.stream(
        { userQuery: prompt },
        { streamMode: "updates" }
      )) {
        // Handle planner updates
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

        // Handle worker updates
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

        // Handle aggregator updates (final result)
        if (event.aggregator?.finalSpec) {
          finalSpec = event.aggregator.finalSpec;
          console.error(chalk.green("\n[Aggregator] Specification generated!\n"));
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Analysis failed: ${errorMsg}`);

      // Provide helpful error messages
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
    // Non-streaming mode - invoke and wait for result
    try {
      const result = await graph.invoke({ userQuery: prompt });
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

  // Output the specification
  if (options.output) {
    const outputPath = resolve(options.output);
    await writeFile(outputPath, finalSpec, "utf-8");
    logger.success(`Specification written to: ${outputPath}`);
  } else {
    // Output to stdout for piping
    console.log(finalSpec);
  }
}

export const specCommand = new Command("spec")
  .description("Generate a specification based on a prompt")
  .argument("<prompt>", "The analysis prompt describing what to analyze")
  .option(
    "-o, --output <file>",
    "Write specification to file instead of stdout"
  )
  .option(
    "--no-stream",
    "Disable streaming progress output"
  )
  .action(specAction);
