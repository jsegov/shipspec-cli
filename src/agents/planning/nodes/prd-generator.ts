/**
 * PRD Generator Node
 * Generates Product Requirements Documents and uses interrupt() for user review.
 */

import { interrupt } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PlanningStateType } from "../state.js";
import type { DocumentReviewInterruptPayload } from "../types.js";
import { PRD_TEMPLATE, buildPRDPrompt } from "../../prompts/planning-templates.js";
import { logger } from "../../../utils/logger.js";

/**
 * Creates the PRD generator node.
 * Generates a PRD and pauses for user review via interrupt.
 *
 * @param model - The chat model to use for PRD generation
 */
export function createPRDGeneratorNode(model: BaseChatModel) {
  return async (state: PlanningStateType): Promise<Partial<PlanningStateType>> => {
    logger.progress("Generating Product Requirements Document...");

    // Build the prompt with current context and any previous feedback
    const prompt = buildPRDPrompt(
      state.initialIdea,
      state.clarificationHistory,
      state.signals,
      state.codeContext,
      state.prd,
      state.userFeedback
    );

    // Generate the PRD
    const response = await model.invoke([
      new SystemMessage(PRD_TEMPLATE),
      new HumanMessage(prompt),
    ]);

    const prdContent =
      typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    logger.success("PRD generated. Awaiting review...");

    // INTERRUPT: Return PRD for user review
    const interruptPayload: DocumentReviewInterruptPayload = {
      type: "prd_review",
      document: prdContent,
      instructions: "Review the PRD. Reply 'approve' to continue or provide feedback for revision.",
    };

    // This pauses execution and returns control to the CLI
    const rawFeedback: unknown = interrupt(interruptPayload);

    // Validate that we received a string
    if (typeof rawFeedback !== "string") {
      throw new Error("Invalid interrupt response: expected string feedback");
    }
    const feedbackStr = rawFeedback.trim();

    // Check if user approved
    if (feedbackStr.toLowerCase() === "approve") {
      logger.success("PRD approved. Moving to tech spec generation.");
      return {
        prd: prdContent,
        phase: "spec_review" as const,
        userFeedback: "", // Clear feedback for next phase
      };
    }

    // User provided feedback - loop back for revision
    logger.info("Feedback received. Revising PRD...");
    return {
      prd: prdContent,
      userFeedback: feedbackStr,
      // phase stays at "prd_review" to loop back
    };
  };
}
