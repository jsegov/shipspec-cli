import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ProductionalizeStateType, ProductionalizeSubtask } from "../state.js";
import type { TokenBudget } from "../../../utils/tokens.js";
import {
  pruneChunksByTokenBudget,
  getAvailableContextBudget,
} from "../../../utils/tokens.js";
import type { CodeChunk } from "../../../core/types/index.js";

const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  evidence: z.object({
    codeRefs: z.array(z.object({
      filepath: z.string(),
      lines: z.string(),
      content: z.string(),
    })),
    links: z.array(z.string()),
  }),
});

const WorkerOutputSchema = z.object({
  findings: z.array(FindingSchema),
  summary: z.string(),
});

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
      const toolResult = await retrieverTool.invoke({
        query: subtask.query,
        k: 10,
      });
      
      if (tokenBudget) {
        try {
          const chunks: CodeChunk[] = JSON.parse(toolResult);
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
      contextString = await webSearchTool.invoke({ query: subtask.query });
      evidenceSource = "Web Research";
    } else if (subtask.source === "scan") {
      const relevantScans = sastResults.filter(r => 
        r.rule.toLowerCase().includes(subtask.category.toLowerCase()) || 
        r.message.toLowerCase().includes(subtask.category.toLowerCase())
      );
      contextString = JSON.stringify(relevantScans, null, 2);
      evidenceSource = "SAST Scanners (Semgrep/Gitleaks/Trivy)";
    }

    const systemPrompt = `You are a specialized production-readiness worker analyzing the category: "${subtask.category}".
Your goal is to identify specific findings (risks, gaps, or best practice violations) based on the provided context.
Ground your analysis in the "Compliance and Best Practices Digest".

For each finding:
1. Assign a severity level.
2. Provide a clear title and description.
3. Include evidence (code references with file/lines for code analysis, or links for web research).
4. Map the finding to its relevance in production readiness or compliance.`;

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Compliance Digest:
${researchDigest}

Analysis Context (${evidenceSource}):
${contextString}

Subtask Query:
${subtask.query}`;

    const output = await structuredModel.invoke([
      new SystemMessage(systemPrompt),
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
      subtasks: [{
        ...subtask,
        status: "complete" as const,
        result: output.summary,
        findings: finalFindings,
      }],
      findings: finalFindings,
    };
  };
}
