/**
 * Target function runner for ask workflow evaluations.
 * Wraps the ask flow for use with LangSmith evaluate().
 */
import { resolve, join } from "path";

import type { ShipSpecConfig } from "../../config/schema.js";
import type { ShipSpecSecrets } from "../../config/loader.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { createChatModel } from "../../core/models/llm.js";
import { askFlow, type AskContext } from "../../flows/ask-flow.js";
import type { AskInput } from "../datasets/schemas.js";

/**
 * Output from the ask runner.
 */
export interface AskRunnerOutput {
  answer: string;
}

/**
 * Configuration for the ask runner.
 */
export interface AskRunnerConfig {
  config: ShipSpecConfig;
  secrets: ShipSpecSecrets;
}

/**
 * Creates a target function for ask workflow evaluation.
 * The returned function can be passed to LangSmith's evaluate().
 *
 * @param runnerConfig - Configuration including ShipSpecConfig and secrets
 * @returns A function that takes inputs and returns outputs
 */
export function createAskRunner(runnerConfig: AskRunnerConfig) {
  return async (inputs: AskInput): Promise<AskRunnerOutput> => {
    const { config, secrets } = runnerConfig;
    const { question, projectPath } = inputs;

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

    // Create model
    const model = await createChatModel(config.llm, secrets.llmApiKey);

    // Build context for ask flow
    const askContext: AskContext = {
      config,
      secrets,
      repository,
      model,
      tokenBudget: {
        maxContextTokens: config.llm.maxContextTokens,
        reservedOutputTokens: config.llm.reservedOutputTokens,
      },
    };

    // Note: Eval examples typically don't include history since each question is standalone.
    // The ask-flow expects ConversationEntry[] with { question, answer } format,
    // but eval schemas use { role, content }. For now, we don't pass history.
    // If history is needed, convert role-based messages to Q&A pairs.

    // Run ask flow and collect answer
    let answer = "";
    for await (const event of askFlow({
      question,
      history: undefined,
      context: askContext,
    })) {
      if (event.type === "token") {
        answer += event.content;
      } else if (event.type === "complete") {
        // Use final answer from complete event if available
        const result = event.result as { answer?: string };
        if (result.answer) {
          answer = result.answer;
        }
      }
    }

    return { answer };
  };
}

/**
 * Simplified runner for testing evaluators without running the full flow.
 * Useful for unit testing evaluators with mock outputs.
 */
export function createMockAskRunner(mockOutput: Partial<AskRunnerOutput>) {
  return (_inputs: AskInput): AskRunnerOutput => {
    return {
      answer: mockOutput.answer ?? "",
    };
  };
}
