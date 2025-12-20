import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentStateType } from "../state.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { SPEC_PLANNER_TEMPLATE, SpecPlanSchema } from "../prompts/index.js";

export function createPlannerNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(SpecPlanSchema);

  return async (state: AgentStateType) => {
    const response = await structuredModel.invoke([
      new SystemMessage(SPEC_PLANNER_TEMPLATE),
      new HumanMessage(`User Query: ${state.userQuery}`),
    ]);

    return {
      subtasks: response.subtasks.map((s) => ({
        ...s,
        status: "pending" as const,
      })),
    };
  };
}
