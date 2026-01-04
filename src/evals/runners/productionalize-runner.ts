/**
 * Target function runner for productionalize workflow evaluations.
 * Wraps the productionalize graph for use with LangSmith evaluate().
 */
import { resolve, join } from "path";
import { MemorySaver } from "@langchain/langgraph";

import type { ShipSpecConfig } from "../../config/schema.js";
import type { ShipSpecSecrets } from "../../config/loader.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { createProductionalizeGraph } from "../../agents/productionalize/graph.js";
import type { Finding, ProductionalizeSubtask } from "../../agents/productionalize/types.js";
import type { ProductionalizeInput } from "../datasets/schemas.js";

/**
 * Output from the productionalize runner.
 */
export interface ProductionalizeRunnerOutput {
  finalReport: string;
  taskPrompts: string;
  findings: Finding[];
  subtasks: ProductionalizeSubtask[];
}

/**
 * Configuration for the productionalize runner.
 */
export interface ProductionalizeRunnerConfig {
  config: ShipSpecConfig;
  secrets: ShipSpecSecrets;
}

/**
 * Creates a target function for productionalize workflow evaluation.
 * The returned function can be passed to LangSmith's evaluate().
 *
 * @param runnerConfig - Configuration including ShipSpecConfig and secrets
 * @returns A function that takes inputs and returns outputs
 */
export function createProductionalizeRunner(runnerConfig: ProductionalizeRunnerConfig) {
  return async (inputs: ProductionalizeInput): Promise<ProductionalizeRunnerOutput> => {
    const { config, secrets } = runnerConfig;
    const { userQuery, projectPath } = inputs;

    // Use provided project path or fall back to config
    const resolvedProjectPath = projectPath ?? config.projectPath;
    const vectorDbPath = join(resolvedProjectPath, ".ship-spec", "lancedb");

    // Initialize vector store and repository
    const vectorStore = new LanceDBManager(resolve(vectorDbPath));

    let resolvedDimensions: number;
    if (config.embedding.dimensions === "auto") {
      const probeEmbeddings = await createEmbeddingsModel(
        config.embedding,
        secrets.embeddingApiKey
      );
      const probeVector = await probeEmbeddings.embedQuery("dimension probe");
      resolvedDimensions = probeVector.length;
    } else {
      resolvedDimensions = config.embedding.dimensions;
    }

    const embeddings = await createEmbeddingsModel(config.embedding, secrets.embeddingApiKey);
    const repository = new DocumentRepository(vectorStore, embeddings, resolvedDimensions);

    // Create graph with memory checkpointer (needed for state management)
    const checkpointer = new MemorySaver();
    const graph = await createProductionalizeGraph(config, repository, {
      checkpointer,
      llmApiKey: secrets.llmApiKey,
      searchApiKey: secrets.tavilyApiKey,
      shouldRedactCloud: config.llm.provider === "openrouter",
    });

    // Run graph in non-interactive mode
    const result = await graph.invoke({
      userQuery,
      interactiveMode: false,
    });

    return {
      finalReport: result.finalReport,
      taskPrompts: result.taskPrompts,
      findings: result.findings,
      subtasks: result.subtasks,
    };
  };
}

/**
 * Simplified runner for testing evaluators without running the full graph.
 * Useful for unit testing evaluators with mock outputs.
 */
export function createMockProductionalizeRunner(mockOutput: Partial<ProductionalizeRunnerOutput>) {
  return (_inputs: ProductionalizeInput): ProductionalizeRunnerOutput => {
    return {
      finalReport: mockOutput.finalReport ?? "",
      taskPrompts: mockOutput.taskPrompts ?? "",
      findings: mockOutput.findings ?? [],
      subtasks: mockOutput.subtasks ?? [],
    };
  };
}
