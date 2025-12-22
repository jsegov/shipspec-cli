import { StateGraph, Send, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { ProductionalizeState, type ProductionalizeStateType } from "./state.js";
import { createResearcherNode } from "./nodes/researcher.js";
import { createPlannerNode } from "./nodes/planner.js";
import { createWorkerNode } from "./nodes/worker.js";
import { createAggregatorNode } from "./nodes/aggregator.js";
import { createTaskGeneratorNode } from "./nodes/task-generator.js";
import { createPromptGeneratorNode } from "./nodes/prompt-generator.js";
import { createWebSearchTool } from "../tools/web-search.js";
import { createSASTScannerTool, ScannerResultsSchema } from "../tools/sast-scanner.js";
import { createRetrieverTool } from "../tools/retriever.js";
import { createChatModel } from "../../core/models/llm.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import type { TokenBudget } from "../../utils/tokens.js";
import { gatherProjectSignals } from "../../core/analysis/project-signals.js";

export interface CreateProductionalizeGraphOptions {
  checkpointer?: BaseCheckpointSaver;
  taskOutputMode?: "taskmaster" | "prompts";
}

export async function createProductionalizeGraph(
  config: ShipSpecConfig,
  repository: DocumentRepository,
  options: CreateProductionalizeGraphOptions = {}
) {
  const model = await createChatModel(config.llm);
  const retrieverTool = createRetrieverTool(repository);
  const webSearchTool = createWebSearchTool(config.productionalize.webSearch);
  const sastTool = createSASTScannerTool(config.productionalize.sast);

  const tokenBudget: TokenBudget = {
    maxContextTokens: config.llm.maxContextTokens,
    reservedOutputTokens: config.llm.reservedOutputTokens,
  };

  const gatherSignalsNode = async () => {
    const signals = await gatherProjectSignals(config.projectPath);
    return { signals };
  };

  const scannerNode = async () => {
    if (!config.productionalize.sast?.enabled) {
      return { sastResults: [] };
    }
    try {
      const resultsString = await sastTool.invoke({});
      const validated = ScannerResultsSchema.parse(JSON.parse(resultsString));

      const findings = validated.findings ?? [];
      const scannerErrors = findings.filter((f) => f.rule === "scanner_error");
      if (scannerErrors.length > 0) {
        const errors = scannerErrors.map((e) => `[${e.tool}] ${e.message}`).join(", ");
        throw new Error(`SAST scanner(s) failed: ${errors}`);
      }

      return { sastResults: findings };
    } catch (error) {
      if (error instanceof Error && error.message.includes("SAST scanner(s) failed")) throw error;
      throw new Error(
        `SAST scanning failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const researcherNode = createResearcherNode(model, webSearchTool);
  const plannerNode = createPlannerNode(model);
  const workerNode = createWorkerNode(model, retrieverTool, webSearchTool, tokenBudget);
  const aggregatorNode = createAggregatorNode(model);
  const taskGeneratorNode = createTaskGeneratorNode(model);
  const promptGeneratorNode = createPromptGeneratorNode(model);

  const workflow = new StateGraph(ProductionalizeState)
    .addNode("gatherSignals", gatherSignalsNode)
    .addNode("researcher", researcherNode)
    .addNode("scanner", scannerNode)
    .addNode("planner", plannerNode)
    .addNode("worker", workerNode)
    .addNode("aggregator", aggregatorNode)
    .addNode("taskGenerator", taskGeneratorNode)
    .addNode("promptGenerator", promptGeneratorNode)
    .addEdge(START, "gatherSignals")
    .addEdge("gatherSignals", "researcher")
    .addEdge("researcher", "scanner")
    .addEdge("scanner", "planner")
    .addConditionalEdges("planner", (state: ProductionalizeStateType) => {
      if (state.subtasks.length === 0) {
        return "aggregator";
      }
      return state.subtasks.map(
        (subtask) =>
          new Send("worker", {
            subtask,
            researchDigest: state.researchDigest,
            sastResults: state.sastResults,
            signals: state.signals,
          })
      );
    })
    .addEdge("worker", "aggregator")
    .addConditionalEdges("aggregator", () => {
      return options.taskOutputMode === "prompts" ? "promptGenerator" : "taskGenerator";
    })
    .addEdge("taskGenerator", END)
    .addEdge("promptGenerator", END);

  return workflow.compile({ checkpointer: options.checkpointer });
}
