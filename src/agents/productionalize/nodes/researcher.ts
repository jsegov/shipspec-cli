import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";

export function createResearcherNode(model: BaseChatModel, webSearchTool: DynamicStructuredTool) {
  return async (state: ProductionalizeStateType) => {
    const { signals } = state;
    
    const queries = [
      "SOC 2 Trust Services Criteria summary for security and availability",
      `Production readiness best practices for ${signals.detectedLanguages.join(", ")} applications`,
      "OWASP ASVS key security verification requirements for web applications",
      "NIST SSDF key secure software development practices overview",
      "Google SRE production readiness launch checklist summary",
    ];

    const results = await Promise.all(
      queries.map((query) => webSearchTool.invoke({ query, maxResults: 3 }))
    );

    const context = results.join("\n\n");

    const summaryResponse = await model.invoke([
      new SystemMessage(`You are a technical researcher. Your goal is to synthesize research into a compact "Compliance and Best Practices Digest" that will ground a production-readiness analysis.
Focus on:
- SOC 2 Security & Availability requirements
- OWASP Top 10 / ASVS highlights
- SRE Launch Checklist essentials
- NIST SSDF practices

Keep the digest structured and actionable.`),
      new HumanMessage(`Based on the following search results and project signals, create a research digest for this project:

Project Signals:
${JSON.stringify(signals, null, 2)}

Search Results:
${context}

Return the digest as a structured markdown summary.`),
    ]);

    return {
      researchDigest: summaryResponse.content as string,
    };
  };
}
