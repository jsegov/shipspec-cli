import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import type { TokenBudget } from "../../../utils/tokens.js";

export function createAggregatorNode(model: BaseChatModel, _tokenBudget?: TokenBudget) {
  return async (state: ProductionalizeStateType) => {
    const { findings, signals, researchDigest } = state;

// #region agent log
    fetch('http://127.0.0.1:7242/ingest/55322ab6-a122-49b2-a3e4-46ea155ba6a6',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'aggregator.ts:8',message:'Aggregator received findings',data:{findingsCount: findings.length, signalsPresent: !!signals, digestLength: researchDigest?.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H-B'})}).catch(()=>{});
// #endregion

    const systemPrompt = `You are a production-readiness report aggregator. Your goal is to synthesize multiple domain-specific findings into a single, cohesive, professional Markdown report.
The report should be structured for a CTO or Engineering Manager.

Report Structure:
1. Executive Summary: High-level readiness score (0-100) and top risks.
2. Category Breakdown: For each major category (Security, SOC 2, Quality, etc.), list the findings with their severity and evidence.
3. Compliance Alignment: Explicitly mention how findings align with SOC 2, OWASP, NIST, and SRE standards from the research digest.
4. Recommendations Timeline: Group findings into "Must Fix Before Production (Critical)", "Next 7 Days (High)", and "Next 30 Days (Medium)".

Maintain a professional, objective tone. Citations (file paths, links) are mandatory.`;

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Research Digest:
${researchDigest}

Findings:
${JSON.stringify(findings, null, 2)}

Generate the final Production Readiness Report in Markdown format.`;

    const reportResponse = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    return {
      finalReport: reportResponse.content as string,
    };
  };
}
