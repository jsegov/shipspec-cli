/**
 * Tech Spec Generator Node
 * Generates Technical Specifications and uses interrupt() for user review.
 *
 * This node uses a two-phase pattern to handle LangGraph's interrupt behavior:
 * - Phase 1: LLM generates spec, stores in pendingTechSpec, returns (saves to state). Graph loops back.
 * - Phase 2: Detect pendingTechSpec, call interrupt() to get user review.
 *   On resume, interrupt() returns the feedback, which we process and clear pendingTechSpec.
 *
 * This ensures the LLM is only called once per generation cycle and the user
 * always reviews the same document that gets saved (no regeneration on resume).
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
    // Phase 2: We have a pending spec awaiting review - interrupt for user feedback.
    // When interrupt() is called, execution stops. On resume, the node re-executes
    // from the beginning with the same state, but interrupt() returns the user's feedback.
    if (state.pendingTechSpec) {
      logger.progress("Tech spec pending review...");

      const interruptPayload: DocumentReviewInterruptPayload = {
        type: "spec_review",
        document: state.pendingTechSpec,
        instructions:
          "Review the technical specification. Reply 'approve' to continue or provide feedback for revision.",
      };

      // First call: stops execution, returns spec to CLI for review
      // Resume call: returns the feedback passed via Command({ resume: ... })
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
          techSpec: state.pendingTechSpec, // Move pending to final
          pendingTechSpec: "", // Clear pending
          phase: "complete" as const,
          userFeedback: "", // Clear feedback
        };
      }

      // User provided feedback - save pending spec as revision base, then clear to trigger regeneration
      logger.info("Feedback received. Revising tech spec...");
      return {
        techSpec: state.pendingTechSpec, // Save as revision base for buildSpecPrompt (will be replaced on approval)
        pendingTechSpec: "", // Clear to trigger Phase 1 regeneration
        userFeedback: feedbackStr,
        // phase stays at "spec_review" to loop back
      };
    }

    // Phase 1: Generate tech spec with LLM
    logger.progress("Generating Technical Specification...");

    // Build the prompt with PRD and codebase context
    const prompt = buildSpecPrompt(
      state.prd,
      state.signals,
      state.codeContext,
      state.techSpec, // Previous spec (revision base if feedback provided, or empty for first generation)
      state.userFeedback
    );

    // Generate the tech spec
    const response = await model.invoke([
      new SystemMessage(SPEC_TEMPLATE),
      new HumanMessage(prompt),
    ]);

    const specContent =
      typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    logger.success("Tech spec generated. Storing for review...");

    // Store spec in pendingTechSpec. Graph will loop back to this node,
    // and the next invocation will detect pendingTechSpec and call interrupt().
    // This ensures the user reviews the exact document that will be saved.
    return {
      pendingTechSpec: specContent,
      userFeedback: "", // Clear feedback after regeneration
    };
  };
}
