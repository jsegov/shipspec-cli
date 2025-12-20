import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import { PRODUCTIONALIZE_PLANNER_TEMPLATE, ProductionalizePlanSchema } from "../../prompts/index.js";

export function createPlannerNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(ProductionalizePlanSchema);

  return async (state: ProductionalizeStateType) => {
    const { userQuery, signals, researchDigest, sastResults } = state;

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Research Digest:
${researchDigest}

SAST Results Summary:
${String(sastResults.length)} findings detected from ${[...new Set(sastResults.map(r => r.tool))].join(", ") || "no tools"}.

User Request:
${userQuery || "Perform a full production-readiness analysis of this codebase."}`;

    const plan = await structuredModel.invoke([
      new SystemMessage(PRODUCTIONALIZE_PLANNER_TEMPLATE),
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
