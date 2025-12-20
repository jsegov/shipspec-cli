import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import type { ProductionalizeSubtask } from "../types.js";
import type { TokenBudget } from "../../../utils/tokens.js";
import {
  pruneChunksByTokenBudget,
  getAvailableContextBudget,
} from "../../../utils/tokens.js";
import type { CodeChunk } from "../../../core/types/index.js";
import { PRODUCTIONALIZE_WORKER_TEMPLATE, WorkerOutputSchema } from "../../prompts/index.js";

export function createWorkerNode(
  model: BaseChatModel,
  retrieverTool: DynamicStructuredTool,
  webSearchTool: DynamicStructuredTool,
  tokenBudget?: TokenBudget
) {
  const structuredModel = model.withStructuredOutput(WorkerOutputSchema);

  return async (state: ProductionalizeStateType & { subtask: ProductionalizeSubtask }) => {
    const { subtask, researchDigest, sastResults, signals } = state;

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
          const prunedChunks = pruneChunksByTokenBudget(
            chunks,
            Math.floor(availableBudget * 0.7)
          );
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

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Compliance Digest:
${researchDigest}

Analysis Context (${evidenceSource}):
${contextString}

Subtask Query:
${subtask.query}`;

    const output = await structuredModel.invoke([
      new SystemMessage(PRODUCTIONALIZE_WORKER_TEMPLATE),
      new HumanMessage(userPrompt),
    ]);

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
