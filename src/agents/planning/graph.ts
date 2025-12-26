/**
 * Planning workflow graph definition.
 * Orchestrates the spec-driven development workflow with human-in-the-loop review cycles.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { PlanningState, type PlanningStateType } from "./state.js";
import { createContextGathererNode } from "./nodes/context-gatherer.js";
import { createClarifierNode } from "./nodes/clarifier.js";
import { createPRDGeneratorNode } from "./nodes/prd-generator.js";
import { createSpecGeneratorNode } from "./nodes/spec-generator.js";
import { createTaskGeneratorNode } from "./nodes/task-generator.js";
import { createChatModel } from "../../core/models/llm.js";
import type { DocumentRepository } from "../../core/storage/repository.js";
import type { ShipSpecConfig } from "../../config/schema.js";

export interface CreatePlanningGraphOptions {
  checkpointer?: BaseCheckpointSaver;
  llmApiKey?: string;
}

/**
 * Creates the planning workflow graph.
 *
 * Workflow:
 * 1. contextGatherer: Collect project signals and RAG context
 * 2. clarifier: Ask follow-up questions until requirements are clear (loops via interrupt)
 * 3. prdGenerator: Generate PRD and await user approval (loops via interrupt)
 * 4. specGenerator: Generate tech spec and await user approval (loops via interrupt)
 * 5. taskGenerator: Generate implementation task prompts
 *
 * @param config - ShipSpec configuration
 * @param repository - DocumentRepository for RAG (null if no index)
 * @param options - Graph options including checkpointer and API key
 */
export async function createPlanningGraph(
  config: ShipSpecConfig,
  repository: DocumentRepository | null,
  options: CreatePlanningGraphOptions = {}
) {
  const model = await createChatModel(config.llm, options.llmApiKey);

  // Create all nodes
  const contextGathererNode = createContextGathererNode(config, repository);
  const clarifierNode = createClarifierNode(model);
  const prdGeneratorNode = createPRDGeneratorNode(model);
  const specGeneratorNode = createSpecGeneratorNode(model);
  const taskGeneratorNode = createTaskGeneratorNode(model);

  // Build the workflow graph
  const workflow = new StateGraph(PlanningState)
    .addNode("contextGatherer", contextGathererNode)
    .addNode("clarifier", clarifierNode)
    .addNode("prdGenerator", prdGeneratorNode)
    .addNode("specGenerator", specGeneratorNode)
    .addNode("taskGenerator", taskGeneratorNode)
    // Start with context gathering
    .addEdge(START, "contextGatherer")
    // Context gatherer leads to clarifier
    .addEdge("contextGatherer", "clarifier")
    // Clarifier can loop back to itself (via interrupt) or proceed to PRD
    .addConditionalEdges("clarifier", (state: PlanningStateType) => {
      if (state.clarificationComplete) {
        return "prdGenerator";
      }
      // Loop back to clarifier (will interrupt for questions)
      return "clarifier";
    })
    // PRD generator can loop back (via interrupt with feedback) or proceed to spec
    .addConditionalEdges("prdGenerator", (state: PlanningStateType) => {
      if (state.phase === "spec_review") {
        return "specGenerator";
      }
      // Loop back to prdGenerator (will interrupt for review)
      return "prdGenerator";
    })
    // Spec generator can loop back (via interrupt with feedback) or proceed to tasks
    .addConditionalEdges("specGenerator", (state: PlanningStateType) => {
      if (state.phase === "complete") {
        return "taskGenerator";
      }
      // Loop back to specGenerator (will interrupt for review)
      return "specGenerator";
    })
    // Task generator ends the workflow
    .addEdge("taskGenerator", END);

  // Compile with optional checkpointer for state persistence
  return workflow.compile({ checkpointer: options.checkpointer });
}
