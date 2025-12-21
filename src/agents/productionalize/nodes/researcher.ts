import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import { RESEARCHER_TEMPLATE } from "../../prompts/index.js";

export function createResearcherNode(model: BaseChatModel, webSearchTool: DynamicStructuredTool) {
  return async (state: ProductionalizeStateType) => {
    const { signals } = state;

    const queries = [
      "SOC 2 Trust Services Criteria summary for security and availability",
      `Production readiness security best practices for ${signals.detectedLanguages.join(
        ", "
      )} applications 2024`,
      "OWASP ASVS key security verification requirements summary",
      "NIST SSDF key secure software development practices overview 2024",
      "Google SRE production readiness launch checklist summary",
      ...(signals.hasDocker ? ["Container security hardening best practices 2024"] : []),
      ...(signals.testFramework
        ? [`Production readiness checklist for ${signals.testFramework} 2024`]
        : []),
    ];

    const results = await Promise.all(
      queries.map((query) => webSearchTool.invoke({ query, maxResults: 3 }))
    );

    const context = results.join("\n\n");

    const messages = [
      new SystemMessage(RESEARCHER_TEMPLATE),
      new HumanMessage(`Based on the following search results and project signals, create a research digest for this project:

Project Signals:
${JSON.stringify(signals, null, 2)}

Search Results:
${context}

Return the digest as a structured markdown summary.`),
    ];

    const summaryResponse = await model.invoke(messages);

    return {
      researchDigest: summaryResponse.content as string,
    };
  };
}
