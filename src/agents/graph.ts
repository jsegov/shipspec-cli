import { StateGraph, Send, START, END } from "@langchain/langgraph";
import { AgentState, type AgentStateType } from "./state.js";
import { createPlannerNode } from "./nodes/planner.js";
import { createWorkerNode } from "./nodes/worker.js";
import { createAggregatorNode } from "./nodes/aggregator.js";
import { createRetrieverTool } from "./tools/retriever.js";
import { createChatModel } from "../core/models/llm.js";
import { DocumentRepository } from "../core/storage/repository.js";
import type { ShipSpecConfig } from "../config/schema.js";

export async function createSpecGraph(
  config: ShipSpecConfig,
  repository: DocumentRepository
) {
  const model = await createChatModel(config.llm);
  const retrieverTool = createRetrieverTool(repository);
  const plannerNode = createPlannerNode(model);
  const workerNode = createWorkerNode(model, retrieverTool);
  const aggregatorNode = createAggregatorNode(model);

  const workflow = new StateGraph(AgentState)
    .addNode("planner", plannerNode)
    .addNode("worker", workerNode)
    .addNode("aggregator", aggregatorNode)
    .addEdge(START, "planner")
    .addConditionalEdges("planner", (state: AgentStateType) => {
      if (!state.subtasks || state.subtasks.length === 0) {
        return "aggregator";
      }
      return state.subtasks.map(
        (subtask) => new Send("worker", { subtask })
      );
    })
    .addEdge("worker", "aggregator")
    .addEdge("aggregator", END);

  return workflow.compile();
}
