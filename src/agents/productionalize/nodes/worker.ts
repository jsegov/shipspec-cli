import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { z } from "zod";
import type { ProductionalizeStateType } from "../state.js";
import type { ProductionalizeSubtask, UserAnalysisContext } from "../types.js";
import type { TokenBudget } from "../../../utils/tokens.js";
import { pruneChunksByTokenBudget, getAvailableContextBudget } from "../../../utils/tokens.js";
import type { CodeChunk } from "../../../core/types/index.js";
import {
  PRODUCTIONALIZE_WORKER_TEMPLATE,
  ProductionalizeWorkerOutputSchema,
} from "../../prompts/index.js";
import { logger } from "../../../utils/logger.js";

type WorkerOutput = z.infer<typeof ProductionalizeWorkerOutputSchema>;

/**
 * Formats user context into a concise string for the worker prompt.
 * Helps workers tailor their analysis to user priorities.
 */
function formatUserContextForWorker(userContext: UserAnalysisContext | null): string {
  if (!userContext) return "";

  const parts: string[] = [];

  if (userContext.primaryConcerns.length > 0) {
    parts.push(`Focus Areas: ${userContext.primaryConcerns.join(", ")}`);
  }

  if (userContext.deploymentTarget) {
    parts.push(`Deployment: ${userContext.deploymentTarget}`);
  }

  if (userContext.complianceRequirements.length > 0) {
    parts.push(`Compliance: ${userContext.complianceRequirements.join(", ")}`);
  }

  if (userContext.additionalContext) {
    parts.push(`Context: ${userContext.additionalContext}`);
  }

  return parts.length > 0 ? `\nUser Requirements:\n${parts.join("\n")}` : "";
}

/**
 * Extended state for worker node that includes the specific subtask being processed.
 * The subtask is passed via Send() when the planner fans out to workers.
 */
interface WorkerState extends ProductionalizeStateType {
  subtask: ProductionalizeSubtask;
}

/**
 * Creates the worker node.
 * Executes individual subtasks and extracts findings.
 *
 * Workers run in parallel via Send(), which makes interrupt() unsuitable.
 * Low confidence findings proceed with a warning; clarification questions
 * are logged but don't pause execution.
 *
 * @param model - The chat model to use
 * @param retrieverTool - Tool for RAG code search
 * @param webSearchTool - Tool for web search
 * @param tokenBudget - Optional token budget for context pruning
 */
export function createWorkerNode(
  model: BaseChatModel,
  retrieverTool: DynamicStructuredTool,
  webSearchTool: DynamicStructuredTool,
  tokenBudget?: TokenBudget
) {
  const structuredModel = model.withStructuredOutput(ProductionalizeWorkerOutputSchema);

  return async (state: WorkerState) => {
    // Note: _interactiveMode is extracted but unused since workers don't use interrupt().
    // It's kept for potential future use if a different architecture is implemented.
    const {
      subtask,
      researchDigest,
      sastResults,
      signals,
      interactiveMode: _interactiveMode,
      userContext,
    } = state;

    let contextString = "";
    let evidenceSource = "";

    if (subtask.source === "code") {
      const toolResult = (await retrieverTool.invoke({
        query: subtask.query,
        k: 10,
      })) as string;

      if (tokenBudget) {
        try {
          const parsed: unknown = JSON.parse(toolResult);
          const chunks = parsed as CodeChunk[];
          const availableBudget = getAvailableContextBudget(tokenBudget);
          const prunedChunks = pruneChunksByTokenBudget(chunks, Math.floor(availableBudget * 0.7));
          contextString = JSON.stringify(prunedChunks, null, 2);
        } catch {
          contextString = toolResult;
        }
      } else {
        contextString = toolResult;
      }
      evidenceSource = "Codebase Analysis (RAG)";
    } else if (subtask.source === "web") {
      const webResult = (await webSearchTool.invoke({
        query: subtask.query,
      })) as string;
      contextString = webResult;
      evidenceSource = "Web Research";
    } else {
      // subtask.source === "scan"
      const relevantScans = sastResults.filter(
        (r) =>
          r.rule.toLowerCase().includes(subtask.category.toLowerCase()) ||
          r.message.toLowerCase().includes(subtask.category.toLowerCase())
      );
      contextString = JSON.stringify(relevantScans, null, 2);
      evidenceSource = "SAST Scanners (Semgrep/Gitleaks/Trivy)";
    }

    // Format user context for tailored analysis
    const userContextSection = formatUserContextForWorker(userContext);

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}
${userContextSection}

Compliance Digest:
${researchDigest}

Analysis Context (${evidenceSource}):
${contextString}

Subtask Query:
${subtask.query}

${userContext ? "IMPORTANT: Frame your findings and recommendations in terms of the user's specified compliance requirements and deployment target. Prioritize issues that align with their stated concerns." : ""}`;

    let output: WorkerOutput;
    try {
      output = await structuredModel.invoke([
        new SystemMessage(PRODUCTIONALIZE_WORKER_TEMPLATE),
        new HumanMessage(userPrompt),
      ]);
    } catch (parseError) {
      // LangChain parser fails on JSON with leading newlines; extract and re-parse
      const errMsg = parseError instanceof Error ? parseError.message : String(parseError);
      const textMatch = /Text: "([\s\S]+?)"\. Error:/.exec(errMsg);
      if (!textMatch?.[1]) throw parseError;
      const parsed: unknown = JSON.parse(textMatch[1].trim());
      output = ProductionalizeWorkerOutputSchema.parse(parsed);
    }

    // Low confidence handling:
    //
    // Workers run in parallel via Send(), which makes interrupt() unsuitable:
    // - Multiple workers calling interrupt() simultaneously causes routing issues
    // - State fields like pendingWorkerClarification use last-write-wins reducers,
    //   so concurrent updates would clobber each other
    // - There's no loop-back edge to handle worker clarification interrupts
    //
    // Instead, we proceed with low confidence analysis and include the
    // clarification questions in the findings for transparency. The report
    // aggregator can highlight areas of uncertainty.

    const hasLowConfidence =
      output.confidenceLevel === "low" &&
      output.clarificationQuestions &&
      output.clarificationQuestions.length > 0;

    if (hasLowConfidence) {
      logger.warn(
        `[${subtask.category}] Low confidence analysis. ` +
          `Questions that could improve accuracy: ${output.clarificationQuestions?.join("; ") ?? "none"}`
      );
    }

    const finalFindings = output.findings.map((f) => {
      if (subtask.source === "scan") {
        return {
          ...f,
          evidence: {
            ...f.evidence,
            scanResults: sastResults.filter(
              (r) =>
                r.rule.toLowerCase().includes(subtask.category.toLowerCase()) ||
                r.message.toLowerCase().includes(subtask.category.toLowerCase())
            ),
          },
        };
      }
      return f;
    });

    return {
      subtasks: [
        {
          ...subtask,
          status: "complete" as const,
          result: output.summary,
          findings: finalFindings,
        },
      ],
      findings: finalFindings,
    };
  };
}
