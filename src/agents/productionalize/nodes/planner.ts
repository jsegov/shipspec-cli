import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ProductionalizeStateType } from "../state.js";

const SubtaskSchema = z.object({
  id: z.string(),
  category: z.string(),
  query: z.string(),
  source: z.enum(["code", "web", "scan"]),
  rationale: z.string(),
});

const PlanSchema = z.object({
  subtasks: z.array(SubtaskSchema),
});

export function createPlannerNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(PlanSchema);

  return async (state: ProductionalizeStateType) => {
    const { userQuery, signals, researchDigest, sastResults } = state;

    const systemPrompt = `You are a production-readiness planner. Your goal is to decompose a codebase analysis request into a structured plan of 6-10 subtasks.
You MUST use a hybrid approach:
1. Always include core categories: security, soc2, code-quality, dependencies, testing, configuration.
2. Add dynamic categories based on project signals (e.g., Container Security if Docker is present).
3. Use specialized sources:
   - "code": For deep analysis of the project's source code (via RAG).
   - "web": For checking external standards or stack-specific best practices.
   - "scan": For analyzing results from pre-run SAST tools (Semgrep, Gitleaks, Trivy).

Ground your plan in the provided research digest and project signals.`;

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Research Digest:
${researchDigest}

SAST Results Summary:
${sastResults.length} findings detected from ${[...new Set(sastResults.map(r => r.tool))].join(", ") || "no tools"}.

User Request:
${userQuery || "Perform a full production-readiness analysis of this codebase."}`;

    const plan = await structuredModel.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    return {
      subtasks: plan.subtasks.map((t) => ({
        ...t,
        status: "pending" as const,
      })),
    };
  };
}
