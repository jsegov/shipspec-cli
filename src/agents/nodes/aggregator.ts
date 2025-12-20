import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentStateType } from "../state.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { TokenBudget } from "../../utils/tokens.js";
import {
  truncateTextByTokenBudget,
  getAvailableContextBudget,
} from "../../utils/tokens.js";
import { SPEC_AGGREGATOR_TEMPLATE } from "../prompts/index.js";

export function createAggregatorNode(
  model: BaseChatModel,
  tokenBudget?: TokenBudget
) {
  return async (state: AgentStateType) => {
    const completedSubtasks = state.subtasks.filter(
      (s) => s.status === "complete"
    );

    let findings = completedSubtasks
      .filter((s): s is typeof s & { result: string } => s.result !== undefined)
      .map((s) => `## ${s.query}\n\n${s.result}`)
      .join("\n\n---\n\n");

    if (tokenBudget) {
      const availableBudget = getAvailableContextBudget(tokenBudget);
      const findingsBudget = Math.floor(availableBudget * 0.6);
      findings = truncateTextByTokenBudget(findings, findingsBudget);
    }

    const response = await model.invoke([
      new SystemMessage(SPEC_AGGREGATOR_TEMPLATE),
      new HumanMessage(`Original Request: ${state.userQuery}

Findings:
${findings}`),
    ]);

    return {
      finalSpec: response.content as string,
    };
  };
}
