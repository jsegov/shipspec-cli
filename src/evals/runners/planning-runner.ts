/**
 * Target function runner for planning workflow evaluations.
 * Wraps the planning graph for use with LangSmith evaluate().
 */
import { resolve, join } from "path";
import { randomUUID } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import { Command as LangGraphCommand } from "@langchain/langgraph";

import type { ShipSpecConfig } from "../../config/schema.js";
import type { ShipSpecSecrets } from "../../config/loader.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { createPlanningGraph } from "../../agents/planning/graph.js";
import type { PlanningStateType } from "../../agents/planning/state.js";
import type { InterruptPayload } from "../../agents/planning/types.js";
import type { PlanningInput } from "../datasets/schemas.js";

/**
 * Output from the planning runner.
 */
export interface PlanningRunnerOutput {
  prd: string;
  techSpec: string;
  taskPrompts: string;
  phase: string;
}

/**
 * Configuration for the planning runner.
 */
export interface PlanningRunnerConfig {
  config: ShipSpecConfig;
  secrets: ShipSpecSecrets;
}

type PlanningResult = PlanningStateType & {
  __interrupt__?: {
    id: string;
    value: InterruptPayload;
  }[];
};

/**
 * Creates a target function for planning workflow evaluation.
 * The returned function can be passed to LangSmith's evaluate().
 *
 * @param runnerConfig - Configuration including ShipSpecConfig and secrets
 * @returns A function that takes inputs and returns outputs
 */
export function createPlanningRunner(runnerConfig: PlanningRunnerConfig) {
  return async (inputs: PlanningInput): Promise<PlanningRunnerOutput> => {
    const { config, secrets } = runnerConfig;
    const { initialIdea, projectPath, clarificationAnswers, prdFeedback, specFeedback } = inputs;

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

    // Create graph with memory checkpointer (required for interrupts)
    const checkpointer = new MemorySaver();
    const graph = await createPlanningGraph(config, repository, {
      checkpointer,
      llmApiKey: secrets.llmApiKey,
    });

    const threadId = randomUUID();
    const graphConfig = { configurable: { thread_id: threadId } };

    // Run graph and handle interrupts with simulated responses
    let result = (await graph.invoke({ initialIdea }, graphConfig)) as PlanningResult;

    // Handle interrupt loop
    let clarificationIndex = 0;
    let totalIterations = 0;
    const MAX_ITERATIONS = 20;

    interruptLoop: while (result.__interrupt__ && result.__interrupt__.length > 0) {
      const interruptObj = result.__interrupt__[0];
      if (!interruptObj) break;

      const interruptValue = interruptObj.value;
      totalIterations++;

      // Safety: limit total iterations to prevent runaway loops
      if (totalIterations > MAX_ITERATIONS) {
        break;
      }

      switch (interruptValue.type) {
        case "clarification": {
          // Use provided clarification answers or auto-approve
          const answer = clarificationAnswers?.[clarificationIndex] ?? "skip";
          clarificationIndex++;
          result = (await graph.invoke(
            new LangGraphCommand({ resume: answer }),
            graphConfig
          )) as PlanningResult;
          break;
        }
        case "prd_review": {
          // Use provided PRD feedback or auto-approve
          const feedback = prdFeedback ?? "approve";
          result = (await graph.invoke(
            new LangGraphCommand({ resume: feedback }),
            graphConfig
          )) as PlanningResult;
          break;
        }
        case "spec_review": {
          // Use provided spec feedback or auto-approve
          const feedback = specFeedback ?? "approve";
          result = (await graph.invoke(
            new LangGraphCommand({ resume: feedback }),
            graphConfig
          )) as PlanningResult;
          break;
        }
        default: {
          // Unknown interrupt type - break out of while loop to prevent infinite loop
          break interruptLoop;
        }
      }
    }

    return {
      prd: result.prd,
      techSpec: result.techSpec,
      taskPrompts: result.taskPrompts,
      phase: result.phase,
    };
  };
}

/**
 * Simplified runner for testing evaluators without running the full graph.
 * Useful for unit testing evaluators with mock outputs.
 */
export function createMockPlanningRunner(mockOutput: Partial<PlanningRunnerOutput>) {
  return (_inputs: PlanningInput): PlanningRunnerOutput => {
    return {
      prd: mockOutput.prd ?? "",
      techSpec: mockOutput.techSpec ?? "",
      taskPrompts: mockOutput.taskPrompts ?? "",
      phase: mockOutput.phase ?? "",
    };
  };
}
