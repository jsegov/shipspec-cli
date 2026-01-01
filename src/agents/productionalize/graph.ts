import { StateGraph, Send, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { ProductionalizeState, type ProductionalizeStateType } from "./state.js";
import { createInterviewerNode } from "./nodes/interviewer.js";
import { createResearcherNode } from "./nodes/researcher.js";
import { createPlannerNode } from "./nodes/planner.js";
import { createWorkerNode } from "./nodes/worker.js";
import { createAggregatorNode } from "./nodes/aggregator.js";
import { createReportReviewerNode } from "./nodes/report-reviewer.js";
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
  llmApiKey?: string;
  searchApiKey?: string;
  shouldRedactCloud?: boolean;
}

export async function createProductionalizeGraph(
  config: ShipSpecConfig,
  repository: DocumentRepository,
  options: CreateProductionalizeGraphOptions = {}
) {
  const model = await createChatModel(config.llm, options.llmApiKey);
  const retrieverTool = createRetrieverTool(repository);
  const webSearchTool = createWebSearchTool(config.productionalize.webSearch, options.searchApiKey);
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

  // Create all nodes
  const interviewerNode = createInterviewerNode(model);
  const researcherNode = createResearcherNode(model, webSearchTool);
  const plannerNode = createPlannerNode(model);
  const workerNode = createWorkerNode(model, retrieverTool, webSearchTool, tokenBudget);
  const aggregatorNode = createAggregatorNode(model);
  const reportReviewerNode = createReportReviewerNode();
  const promptGeneratorNode = createPromptGeneratorNode(model, options.shouldRedactCloud);

  /**
   * Graph Topology:
   *
   * START
   *   → gatherSignals
   *   → interviewer ←┐ (loops until interview complete via interrupt)
   *   ─────────────┘
   *   → researcher
   *   → scanner
   *   → planner
   *   → workers (parallel via Send) ←┐ (optional clarification interrupts)
   *   ───────────────────────────────┘
   *   → aggregator ←┐ (loops if report feedback provided)
   *   → reportReviewer ──┘
   *   → promptGenerator
   *   → END
   */
  const workflow = new StateGraph(ProductionalizeState)
    .addNode("gatherSignals", gatherSignalsNode)
    .addNode("interviewer", interviewerNode)
    .addNode("researcher", researcherNode)
    .addNode("scanner", scannerNode)
    .addNode("planner", plannerNode)
    .addNode("worker", workerNode)
    .addNode("aggregator", aggregatorNode)
    .addNode("reportReviewer", reportReviewerNode)
    .addNode("promptGenerator", promptGeneratorNode)
    // Start with signal gathering
    .addEdge(START, "gatherSignals")
    // Signal gathering leads to interviewer
    .addEdge("gatherSignals", "interviewer")
    // Interviewer loops back to itself (via interrupt) until complete
    .addConditionalEdges("interviewer", (state: ProductionalizeStateType) => {
      if (state.interviewComplete) {
        return "researcher";
      }
      // Loop back to interviewer for interrupt handling
      return "interviewer";
    })
    // Research phase
    .addEdge("researcher", "scanner")
    .addEdge("scanner", "planner")
    // Planner creates subtasks and fans out to workers
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
            interactiveMode: state.interactiveMode,
            userContext: state.userContext,
          })
      );
    })
    // Workers complete and go to aggregator
    .addEdge("worker", "aggregator")
    // Aggregator goes to report reviewer (in interactive mode when review needed) or directly to prompt generator
    .addConditionalEdges("aggregator", (state: ProductionalizeStateType) => {
      // Check if a new report needs user review
      // reportNeedsReview is set by aggregator when generating/regenerating a report
      if (state.interactiveMode && state.reportNeedsReview) {
        return "reportReviewer";
      }
      return "promptGenerator";
    })
    // Report reviewer can approve (go to prompt generator) or provide feedback (go back to aggregator)
    .addConditionalEdges("reportReviewer", (state: ProductionalizeStateType) => {
      if (state.reportApproved) {
        return "promptGenerator";
      }
      // Feedback was provided - regenerate report
      return "aggregator";
    })
    // Prompt generator ends the workflow
    .addEdge("promptGenerator", END);

  return workflow.compile({ checkpointer: options.checkpointer });
}
