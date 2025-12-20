import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import { PRODUCTIONALIZE_AGGREGATOR_TEMPLATE } from "../../prompts/index.js";

export function createAggregatorNode(model: BaseChatModel) {
  return async (state: ProductionalizeStateType) => {
    const { findings, signals, researchDigest } = state;

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Research Digest:
${researchDigest}

Findings:
${JSON.stringify(findings, null, 2)}

Generate the final Production Readiness Report in Markdown format.`;

    const reportResponse = await model.invoke([
      new SystemMessage(PRODUCTIONALIZE_AGGREGATOR_TEMPLATE),
      new HumanMessage(userPrompt),
    ]);

    return {
      finalReport: reportResponse.content as string,
    };
  };
}
