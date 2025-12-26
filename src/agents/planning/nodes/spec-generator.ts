/**
 * Tech Spec Generator Node
 * Generates Technical Specifications and uses interrupt() for user review.
 */

import { interrupt } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PlanningStateType } from "../state.js";
import type { DocumentReviewInterruptPayload } from "../types.js";
import { SPEC_TEMPLATE, buildSpecPrompt } from "../../prompts/planning-templates.js";
import { logger } from "../../../utils/logger.js";

/**
 * Creates the tech spec generator node.
 * Generates a technical specification and pauses for user review via interrupt.
 *
 * @param model - The chat model to use for spec generation
 */
export function createSpecGeneratorNode(model: BaseChatModel) {
  return async (state: PlanningStateType): Promise<Partial<PlanningStateType>> => {
    logger.progress("Generating Technical Specification...");

    // Build the prompt with PRD and codebase context
    const prompt = buildSpecPrompt(
      state.prd,
      state.signals,
      state.codeContext,
      state.techSpec,
      state.userFeedback
    );

    // Generate the tech spec
    const response = await model.invoke([
      new SystemMessage(SPEC_TEMPLATE),
      new HumanMessage(prompt),
    ]);

    const specContent =
      typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    logger.success("Tech spec generated. Awaiting review...");

    // INTERRUPT: Return spec for user review
    const interruptPayload: DocumentReviewInterruptPayload = {
      type: "spec_review",
      document: specContent,
      instructions:
        "Review the technical specification. Reply 'approve' to continue or provide feedback for revision.",
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
      logger.success("Tech spec approved. Moving to task generation.");
      return {
        techSpec: specContent,
        phase: "complete" as const,
        userFeedback: "", // Clear feedback
      };
    }

    // User provided feedback - loop back for revision
    logger.info("Feedback received. Revising tech spec...");
    return {
      techSpec: specContent,
      userFeedback: feedbackStr,
      // phase stays at "spec_review" to loop back
    };
  };
}
