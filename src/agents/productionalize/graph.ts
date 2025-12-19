import { StateGraph, Send, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { ProductionalizeState, type ProductionalizeStateType } from "./state.js";
import { createResearcherNode } from "./nodes/researcher.js";
import { createPlannerNode } from "./nodes/planner.js";
import { createWorkerNode } from "./nodes/worker.js";
import { createAggregatorNode } from "./nodes/aggregator.js";
import { createTaskGeneratorNode } from "./nodes/task-generator.js";
import { createWebSearchTool } from "../tools/web-search.js";
import { createSASTScannerTool } from "../tools/sast-scanner.js";
import { createRetrieverTool } from "../tools/retriever.js";
import { createChatModel } from "../../core/models/llm.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import type { TokenBudget } from "../../utils/tokens.js";
import { gatherProjectSignals } from "../../core/analysis/project-signals.js";

export interface CreateProductionalizeGraphOptions {
  checkpointer?: BaseCheckpointSaver;
}

export async function createProductionalizeGraph(
  config: ShipSpecConfig,
  repository: DocumentRepository,
  options: CreateProductionalizeGraphOptions = {}
) {
  const model = await createChatModel(config.llm);
  const retrieverTool = createRetrieverTool(repository);
  const webSearchTool = createWebSearchTool(config.productionalize?.webSearch);
  const sastTool = createSASTScannerTool(config.productionalize?.sast);

  const tokenBudget: TokenBudget = {
    maxContextTokens: config.llm.maxContextTokens ?? 16000,
    reservedOutputTokens: config.llm.reservedOutputTokens ?? 4000,
  };

  const gatherSignalsNode = async (_state: ProductionalizeStateType) => {
    const signals = await gatherProjectSignals(config.projectPath);
    return { signals };
  };

  const scannerNode = async (_state: ProductionalizeStateType) => {
    if (!config.productionalize?.sast?.enabled) {
      return { sastResults: [] };
    }
    const resultsString = await sastTool.invoke({});
// #region agent log
    fetch('http://127.0.0.1:7242/ingest/55322ab6-a122-49b2-a3e4-46ea155ba6a6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'graph.ts:46',message:'SAST Tool raw results',data:{resultsString: resultsString.slice(0, 500)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H-D'})}).catch(()=>{});
// #endregion
    try {
      const results = JSON.parse(resultsString);
      return { sastResults: results.findings || [] };
    } catch {
      return { sastResults: [] };
    }
  };

  const researcherNode = createResearcherNode(model, webSearchTool);
  const plannerNode = createPlannerNode(model);
  const workerNode = createWorkerNode(model, retrieverTool, webSearchTool, tokenBudget);
  const aggregatorNode = createAggregatorNode(model, tokenBudget);
  const taskGeneratorNode = createTaskGeneratorNode(model);

  const workflow = new StateGraph(ProductionalizeState)
    .addNode("gatherSignals", gatherSignalsNode)
    .addNode("researcher", researcherNode)
    .addNode("scanner", scannerNode)
    .addNode("planner", plannerNode)
    .addNode("worker", workerNode)
    .addNode("aggregator", aggregatorNode)
    .addNode("taskGenerator", taskGeneratorNode)
    .addEdge(START, "gatherSignals")
    .addEdge("gatherSignals", "researcher")
    .addEdge("researcher", "scanner")
    .addEdge("scanner", "planner")
    .addConditionalEdges("planner", (state: ProductionalizeStateType) => {
      if (!state.subtasks || state.subtasks.length === 0) {
        return "aggregator";
      }
      return state.subtasks.map(
        (subtask) => new Send("worker", { 
          subtask,
          researchDigest: state.researchDigest,
          sastResults: state.sastResults,
          signals: state.signals
        })
      );
    })
    .addEdge("worker", "aggregator")
    .addEdge("aggregator", "taskGenerator")
    .addEdge("taskGenerator", END);

  return workflow.compile({ checkpointer: options.checkpointer });
}
