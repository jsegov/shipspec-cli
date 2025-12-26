/**
 * Clarifier Node
 * Uses structured output to generate clarifying questions and interrupt() to pause for user answers.
 */

import { z } from "zod";
import { interrupt } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PlanningStateType } from "../state.js";
import type { ClarificationInterruptPayload, ClarificationEntry } from "../types.js";
import { CLARIFIER_TEMPLATE, buildClarifierPrompt } from "../../prompts/planning-templates.js";
import { logger } from "../../../utils/logger.js";

/**
 * Schema for clarifier structured output.
 */
const ClarificationSchema = z.object({
  satisfied: z
    .boolean()
    .describe("Whether you have enough information to write a comprehensive PRD"),
  followUpQuestions: z
    .array(z.string())
    .max(3)
    .describe("Follow-up questions to ask the user (empty if satisfied)"),
  reasoning: z
    .string()
    .describe("Brief explanation of why you are or are not satisfied with the current information"),
});

/**
 * Creates the clarifier node.
 * Evaluates whether requirements are clear and asks follow-up questions via interrupt.
 *
 * This node uses a two-phase pattern to handle LangGraph's interrupt behavior:
 * - Phase 1: LLM evaluates requirements and generates questions. If questions needed,
 *   store them in pendingQuestions and return (no interrupt yet). Graph loops back.
 * - Phase 2: Detect pendingQuestions, call interrupt() to get user answers.
 *   On resume, interrupt() returns the answers, which we process and clear pendingQuestions.
 *
 * This ensures the LLM is only called once per clarification cycle.
 *
 * @param model - The chat model to use for clarification
 */
export function createClarifierNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(ClarificationSchema);

  return async (state: PlanningStateType): Promise<Partial<PlanningStateType>> => {
    // If clarification is already complete, transition to PRD phase
    if (state.clarificationComplete) {
      logger.info("Clarification complete, moving to PRD generation.");
      return { phase: "prd_review" as const };
    }

    // Phase 2: We have pending questions - interrupt for user answers.
    // When interrupt() is called, execution stops. On resume, the node re-executes
    // from the beginning with the same state, but interrupt() returns the user's answers.
    if (state.pendingQuestions.length > 0) {
      logger.progress(`Asking ${String(state.pendingQuestions.length)} clarifying questions...`);

      const interruptPayload: ClarificationInterruptPayload = {
        type: "clarification",
        questions: state.pendingQuestions,
      };

      // First call: stops execution, returns questions to CLI
      // Resume call: returns the answers passed via Command({ resume: ... })
      const rawAnswers: unknown = interrupt(interruptPayload);

      // Validate that we received a record of string answers
      if (typeof rawAnswers !== "object" || rawAnswers === null) {
        throw new Error("Invalid interrupt response: expected object with string answers");
      }
      const answers = rawAnswers as Record<string, string>;

      // Map questions and answers to clarification history entries
      const newHistory: ClarificationEntry[] = state.pendingQuestions.map((q, i) => ({
        question: q,
        answer: answers[String(i)] ?? "",
      }));

      // Clear pending questions and add answers to history.
      // Graph will loop back to clarifier for next evaluation.
      return {
        clarificationHistory: newHistory,
        pendingQuestions: [],
      };
    }

    // Phase 1: Evaluate requirements clarity with LLM
    logger.progress("Evaluating requirements clarity...");

    // Build the prompt with current context
    const prompt = buildClarifierPrompt(
      state.initialIdea,
      state.clarificationHistory,
      state.signals,
      state.codeContext
    );

    // Get structured output from LLM
    const result = await structuredModel.invoke([
      new SystemMessage(CLARIFIER_TEMPLATE),
      new HumanMessage(prompt),
    ]);

    logger.info(`Clarifier reasoning: ${result.reasoning}`);

    // If satisfied, mark clarification complete and transition
    if (result.satisfied) {
      logger.success("Requirements are clear. Proceeding to PRD generation.");
      return {
        clarificationComplete: true,
        phase: "prd_review" as const,
      };
    }

    // Edge case: LLM says not satisfied but provided no questions.
    // Log a warning and proceed anyway to avoid infinite loops.
    if (result.followUpQuestions.length === 0) {
      logger.warn(
        "LLM indicated not satisfied but provided no follow-up questions. Proceeding to PRD generation."
      );
      return {
        clarificationComplete: true,
        phase: "prd_review" as const,
      };
    }

    // Store questions in state. Graph will loop back to this node,
    // and the next invocation will detect pendingQuestions and call interrupt().
    // This ensures we don't call the LLM again on resume.
    return {
      pendingQuestions: result.followUpQuestions,
    };
  };
}
