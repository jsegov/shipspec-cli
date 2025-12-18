import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentStateType } from "../state.js";
import { HumanMessage } from "@langchain/core/messages";

const SubtaskSchema = z.object({
  subtasks: z.array(z.object({
    id: z.string(),
    query: z.string().describe("Specific question to investigate"),
  })).nonempty().min(1),
});

export function createPlannerNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(SubtaskSchema);

  return async (state: AgentStateType) => {
    const response = await structuredModel.invoke([
      new HumanMessage(`Decompose this request into specific code analysis subtasks:

User Query: ${state.userQuery}

Break this into 3-7 focused subtasks that can be investigated independently.`),
    ]);

    return {
      subtasks: response.subtasks.map((s) => ({
        ...s,
        status: "pending" as const,
      })),
    };
  };
}
