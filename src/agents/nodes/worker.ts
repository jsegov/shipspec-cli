import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { AgentStateType, Subtask } from "../state.js";
import { HumanMessage } from "@langchain/core/messages";

export function createWorkerNode(
  model: BaseChatModel,
  retrieverTool: DynamicStructuredTool
) {
  return async (state: AgentStateType & { subtask: Subtask }) => {
    const { subtask } = state;

    const toolResult = await retrieverTool.invoke({
      query: subtask.query,
      k: 10,
    });

    const summary = await model.invoke([
      new HumanMessage(`Analyze the following code context for: "${subtask.query}"

Code Context:
${toolResult}

Provide a concise technical summary of the findings.`),
    ]);

    return {
      subtasks: [{
        ...subtask,
        status: "complete" as const,
        result: summary.content as string,
      }],
    };
  };
}
