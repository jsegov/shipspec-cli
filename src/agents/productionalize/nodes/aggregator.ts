import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import { PRODUCTIONALIZE_AGGREGATOR_TEMPLATE } from "../../prompts/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * Creates the aggregator node.
 * Synthesizes all findings into a cohesive production readiness report.
 *
 * If report feedback is provided (from user review), incorporates the feedback
 * into the regenerated report.
 *
 * @param model - The chat model to use
 */
export function createAggregatorNode(model: BaseChatModel) {
  return async (state: ProductionalizeStateType) => {
    const { findings, signals, researchDigest, reportFeedback, finalReport } = state;

    // Check if this is a regeneration with feedback
    const hasUserFeedback = reportFeedback && reportFeedback.trim().length > 0;
    if (hasUserFeedback) {
      logger.progress("Regenerating report with user feedback...");
    }

    // Build the prompt with optional feedback context
    let userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Research Digest:
${researchDigest}

Findings:
${JSON.stringify(findings, null, 2)}`;

    if (hasUserFeedback) {
      // Always include feedback when present, even if finalReport is empty
      if (finalReport) {
        userPrompt += `

## Previous Report
${finalReport}`;
      }
      userPrompt += `

## User Feedback
${reportFeedback}

Regenerate the Production Readiness Report, addressing the user's feedback above.
${finalReport ? "Maintain the same structure but incorporate the requested changes." : "Generate a complete report that addresses the feedback."}`;
    } else {
      userPrompt += `

Generate the final Production Readiness Report in Markdown format.`;
    }

    const reportResponse = await model.invoke([
      new SystemMessage(PRODUCTIONALIZE_AGGREGATOR_TEMPLATE),
      new HumanMessage(userPrompt),
    ]);

    return {
      finalReport: reportResponse.content as string,
      // Clear the feedback after regeneration to prevent infinite loops
      reportFeedback: "",
      // Signal that a new report was generated and needs review
      reportNeedsReview: true,
    };
  };
}
