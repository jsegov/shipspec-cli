import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentStateType } from "../state.js";
import { HumanMessage } from "@langchain/core/messages";

export function createAggregatorNode(model: BaseChatModel) {
  return async (state: AgentStateType) => {
    const completedSubtasks = state.subtasks.filter(
      (s) => s.status === "complete"
    );

    const findings = completedSubtasks
      .filter((s) => s.result !== undefined)
      .map((s) => `## ${s.query}\n\n${s.result}`)
      .join("\n\n---\n\n");

    const response = await model.invoke([
      new HumanMessage(`Create a comprehensive technical specification based on these analysis findings.

Original Request: ${state.userQuery}

Analysis Findings:
${findings}

Generate a well-structured markdown specification that synthesizes these findings into actionable implementation guidance.`),
    ]);

    return {
      finalSpec: response.content as string,
    };
  };
}
