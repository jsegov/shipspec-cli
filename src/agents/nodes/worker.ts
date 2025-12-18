import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { AgentStateType, Subtask } from "../state.js";
import { HumanMessage } from "@langchain/core/messages";
import type { TokenBudget } from "../../utils/tokens.js";
import {
  pruneChunksByTokenBudget,
  getAvailableContextBudget,
} from "../../utils/tokens.js";
import type { CodeChunk } from "../../core/types/index.js";

export function createWorkerNode(
  model: BaseChatModel,
  retrieverTool: DynamicStructuredTool,
  tokenBudget?: TokenBudget
) {
  return async (state: AgentStateType & { subtask: Subtask }) => {
    const { subtask } = state;

    const toolResult = await retrieverTool.invoke({
      query: subtask.query,
      k: 10,
    });

    let contextString = toolResult;
    if (tokenBudget) {
      try {
        const chunks: CodeChunk[] = JSON.parse(toolResult);
        const availableBudget = getAvailableContextBudget(tokenBudget);
        const chunkBudget = Math.floor(availableBudget * 0.7);
        const prunedChunks = pruneChunksByTokenBudget(chunks, chunkBudget);
        contextString = JSON.stringify(prunedChunks);
      } catch {
        // Fall back to original if parsing fails
      }
    }

    const summary = await model.invoke([
      new HumanMessage(`Analyze the following code context for: "${subtask.query}"

Code Context:
${contextString}

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
