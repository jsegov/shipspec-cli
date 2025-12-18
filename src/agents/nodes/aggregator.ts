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
      new HumanMessage(`Create a technical specification based on these findings.

Original Request: ${state.userQuery}

Findings:
${findings}

Generate a structured markdown specification with actionable guidance.`),
    ]);

    return {
      finalSpec: response.content as string,
    };
  };
}
