import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Subtask } from "../state.js";
import { HumanMessage } from "@langchain/core/messages";

export interface WorkerInput {
  subtask: Subtask;
}

export function createWorkerNode(
  model: BaseChatModel,
  retrieverTool: DynamicStructuredTool
) {
  return async (input: WorkerInput) => {
    const { subtask } = input;

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
