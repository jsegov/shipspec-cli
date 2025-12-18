import { StateGraph, Send, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { AgentState, type AgentStateType } from "./state.js";
import { createPlannerNode } from "./nodes/planner.js";
import { createWorkerNode } from "./nodes/worker.js";
import { createAggregatorNode } from "./nodes/aggregator.js";
import { createRetrieverTool } from "./tools/retriever.js";
import { createChatModel } from "../core/models/llm.js";
import { DocumentRepository } from "../core/storage/repository.js";
import type { ShipSpecConfig } from "../config/schema.js";
import type { TokenBudget } from "../utils/tokens.js";

export interface CreateSpecGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

export async function createSpecGraph(
  config: ShipSpecConfig,
  repository: DocumentRepository,
  options: CreateSpecGraphOptions = {}
) {
  const model = await createChatModel(config.llm);
  const retrieverTool = createRetrieverTool(repository);
  const plannerNode = createPlannerNode(model);

  const tokenBudget: TokenBudget = {
    maxContextTokens: config.llm.maxContextTokens ?? 16000,
    reservedOutputTokens: config.llm.reservedOutputTokens ?? 4000,
  };

  const workerNode = createWorkerNode(model, retrieverTool, tokenBudget);
  const aggregatorNode = createAggregatorNode(model, tokenBudget);

  const workflow = new StateGraph(AgentState)
    .addNode("planner", plannerNode)
    .addNode("worker", workerNode)
    .addNode("aggregator", aggregatorNode)
    .addEdge(START, "planner")
    .addConditionalEdges("planner", (state: AgentStateType) => {
      if (!state.subtasks || state.subtasks.length === 0) {
        return "aggregator";
      }
      const sends = state.subtasks.map(
        (subtask) => new Send("worker", { subtask })
      );
      return sends;
    })
    .addEdge("worker", "aggregator")
    .addEdge("aggregator", END);

  return workflow.compile({ checkpointer: options.checkpointer });
}
