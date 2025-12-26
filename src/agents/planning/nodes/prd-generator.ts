/**
 * PRD Generator Node
 * Generates Product Requirements Documents and uses interrupt() for user review.
 *
 * This node uses a two-phase pattern to handle LangGraph's interrupt behavior:
 * - Phase 1: LLM generates PRD, stores in pendingPrd, returns (saves to state). Graph loops back.
 * - Phase 2: Detect pendingPrd, call interrupt() to get user review.
 *   On resume, interrupt() returns the feedback, which we process and clear pendingPrd.
 *
 * This ensures the LLM is only called once per generation cycle and the user
 * always reviews the same document that gets saved (no regeneration on resume).
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
    // Phase 2: We have a pending PRD awaiting review - interrupt for user feedback.
    // When interrupt() is called, execution stops. On resume, the node re-executes
    // from the beginning with the same state, but interrupt() returns the user's feedback.
    if (state.pendingPrd) {
      logger.progress("PRD pending review...");

      const interruptPayload: DocumentReviewInterruptPayload = {
        type: "prd_review",
        document: state.pendingPrd,
        instructions:
          "Review the PRD. Reply 'approve' to continue or provide feedback for revision.",
      };

      // First call: stops execution, returns PRD to CLI for review
      // Resume call: returns the feedback passed via Command({ resume: ... })
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
          prd: state.pendingPrd, // Move pending to final
          pendingPrd: "", // Clear pending
          phase: "spec_review" as const,
          userFeedback: "", // Clear feedback for next phase
        };
      }

      // User provided feedback - clear pending PRD to trigger regeneration
      logger.info("Feedback received. Revising PRD...");
      return {
        pendingPrd: "", // Clear to trigger Phase 1 regeneration
        userFeedback: feedbackStr,
        // phase stays at "prd_review" to loop back
      };
    }

    // Phase 1: Generate PRD with LLM
    logger.progress("Generating Product Requirements Document...");

    // Build the prompt with current context and any previous feedback
    const prompt = buildPRDPrompt(
      state.initialIdea,
      state.clarificationHistory,
      state.signals,
      state.codeContext,
      state.prd, // Previous approved PRD (for revision context)
      state.userFeedback
    );

    // Generate the PRD
    const response = await model.invoke([
      new SystemMessage(PRD_TEMPLATE),
      new HumanMessage(prompt),
    ]);

    const prdContent =
      typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    logger.success("PRD generated. Storing for review...");

    // Store PRD in pendingPrd. Graph will loop back to this node,
    // and the next invocation will detect pendingPrd and call interrupt().
    // This ensures the user reviews the exact document that will be saved.
    return {
      pendingPrd: prdContent,
      userFeedback: "", // Clear feedback after regeneration
    };
  };
}
