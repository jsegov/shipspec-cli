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
// ... (omitted content)
    ]);

// #region agent log
    fetch('http://127.0.0.1:7242/ingest/55322ab6-a122-49b2-a3e4-46ea155ba6a6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'researcher.ts:43',message:'Researcher digest generated',data:{digestLength: (summaryResponse.content as string).length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H-C'})}).catch(()=>{});
// #endregion

    return {
      researchDigest: summaryResponse.content as string,
    };
  };
}
