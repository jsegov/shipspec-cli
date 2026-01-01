/**
 * Report Reviewer Node
 * Pauses for user review of the production readiness report before generating task prompts.
 * Uses interrupt() to allow the user to approve or provide feedback.
 */

import { interrupt } from "@langchain/langgraph";
import type { ProductionalizeStateType } from "../state.js";
import type { ReportReviewInterruptPayload } from "../types.js";
import { logger } from "../../../utils/logger.js";

/**
 * Creates the report reviewer node.
 * Pauses execution to display the report and get user approval or feedback.
 *
 * In interactive mode:
 * - Interrupts to show the report
 * - User can type "approve" to proceed
 * - User can provide feedback to trigger report regeneration
 *
 * In non-interactive mode:
 * - Skips review and proceeds directly to task generation
 *
 * @returns A node function for the LangGraph workflow
 */
export function createReportReviewerNode() {
  return (
    state: ProductionalizeStateType
  ): Partial<ProductionalizeStateType> | Promise<Partial<ProductionalizeStateType>> => {
    // If not in interactive mode, skip review
    if (!state.interactiveMode) {
      logger.info("Non-interactive mode: skipping report review.");
      return { reportApproved: true };
    }

    // If already approved, proceed
    if (state.reportApproved) {
      logger.info("Report already approved, proceeding to task generation.");
      return {};
    }

    // Check if we have a report to review
    if (!state.finalReport) {
      logger.warn("No report available for review.");
      return { reportApproved: true };
    }

    // Interrupt for user review
    logger.progress("Report ready for review...");

    const interruptPayload: ReportReviewInterruptPayload = {
      type: "report_review",
      report: state.finalReport,
    };

    // First call: stops execution, returns report to CLI
    // Resume call: returns the feedback passed via Command({ resume: ... })
    const rawFeedback: unknown = interrupt(interruptPayload);

    // Validate that we received a string response
    if (typeof rawFeedback !== "string") {
      throw new Error("Invalid interrupt response: expected string feedback");
    }

    const feedback = rawFeedback.trim().toLowerCase();

    // Check if user approved (empty input = approval, user just pressed Enter)
    if (
      feedback === "" ||
      feedback === "approve" ||
      feedback === "approved" ||
      feedback === "yes" ||
      feedback === "y" ||
      feedback === "ok" ||
      feedback === "lgtm"
    ) {
      logger.success("Report approved. Proceeding to task generation.");
      return {
        reportApproved: true,
        reportFeedback: "",
        // Clear the review flag since we've completed review
        reportNeedsReview: false,
      };
    }

    // User provided feedback - store it for report regeneration
    logger.info("Feedback received. Report will be regenerated.");
    return {
      reportApproved: false,
      reportFeedback: rawFeedback.trim(),
      // Clear the review flag - we've handled this report, aggregator will set it again
      reportNeedsReview: false,
    };
  };
}
