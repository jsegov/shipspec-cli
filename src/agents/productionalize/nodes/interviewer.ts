/**
 * Interviewer Node
 * Uses structured output to generate clarifying questions and interrupt() to pause for user answers.
 * Follows the two-phase interrupt pattern from planning/nodes/clarifier.ts.
 */

import { z } from "zod";
import { interrupt } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProductionalizeStateType } from "../state.js";
import type {
  InterviewInterruptPayload,
  InterviewQuestion,
  UserAnalysisContext,
} from "../types.js";
import { INTERVIEWER_TEMPLATE } from "../../prompts/templates.js";
import { logger } from "../../../utils/logger.js";
import type { ProjectSignals } from "../../../core/analysis/project-signals.js";

/**
 * Schema for a single interview question.
 */
const InterviewQuestionSchema = z.object({
  id: z.string().describe("Unique identifier for the question"),
  question: z.string().describe("The question text"),
  type: z.enum(["select", "multiselect", "text"]).describe("Question type for UI rendering"),
  options: z.array(z.string()).optional().describe("Options for select/multiselect questions"),
  required: z.boolean().describe("Whether the question is required"),
});

/**
 * Schema for interviewer structured output.
 */
const InterviewerOutputSchema = z.object({
  satisfied: z
    .boolean()
    .describe("Whether you have enough information from project signals to proceed"),
  questions: z
    .array(InterviewQuestionSchema)
    .max(4)
    .describe("Follow-up questions to ask the user (empty if satisfied)"),
  reasoning: z
    .string()
    .describe("Brief explanation of why you are or are not satisfied with the current information"),
});

/**
 * Infers user context from project signals when no interview is needed.
 */
function inferContextFromSignals(signals: ProjectSignals, userQuery: string): UserAnalysisContext {
  const context: UserAnalysisContext = {
    primaryConcerns: [],
    deploymentTarget: null,
    complianceRequirements: [],
    priorityCategories: [],
    additionalContext: userQuery || "",
  };

  // Infer deployment target from signals
  if (signals.hasIaC && signals.iacTool) {
    // If using terraform/IaC, likely cloud deployment
    if (signals.iacTool.toLowerCase().includes("terraform")) {
      context.deploymentTarget = "aws"; // Default assumption for terraform
    }
  }

  // Infer container security priority from Docker presence
  if (signals.hasDocker) {
    context.priorityCategories.push("container-security");
  }

  // Infer compliance from user query
  const queryLower = userQuery.toLowerCase();
  if (queryLower.includes("hipaa")) {
    context.complianceRequirements.push("hipaa");
  }
  if (queryLower.includes("soc") || queryLower.includes("soc2")) {
    context.complianceRequirements.push("soc2");
  }
  if (queryLower.includes("gdpr")) {
    context.complianceRequirements.push("gdpr");
  }
  if (queryLower.includes("pci")) {
    context.complianceRequirements.push("pci-dss");
  }

  // Default to security as primary concern if not specified
  if (context.primaryConcerns.length === 0) {
    context.primaryConcerns.push("security", "compliance");
  }

  return context;
}

/**
 * Parses interview answers and maps them to UserAnalysisContext.
 */
function parseInterviewAnswers(
  answers: Record<string, string | string[]>,
  questions: InterviewQuestion[]
): UserAnalysisContext {
  const context: UserAnalysisContext = {
    primaryConcerns: [],
    deploymentTarget: null,
    complianceRequirements: [],
    priorityCategories: [],
    additionalContext: "",
  };

  for (const question of questions) {
    const answer = answers[question.id];
    if (!answer) continue;

    const questionLower = question.question.toLowerCase();

    // Map answers to context fields based on question content
    if (
      questionLower.includes("deployment") ||
      questionLower.includes("cloud") ||
      questionLower.includes("infrastructure")
    ) {
      if (typeof answer === "string") {
        const answerLower = answer.toLowerCase();
        if (answerLower.includes("aws")) context.deploymentTarget = "aws";
        else if (answerLower.includes("gcp") || answerLower.includes("google"))
          context.deploymentTarget = "gcp";
        else if (answerLower.includes("azure")) context.deploymentTarget = "azure";
        else if (answerLower.includes("on-prem")) context.deploymentTarget = "on-premises";
        else if (answerLower.includes("hybrid")) context.deploymentTarget = "hybrid";
      }
    } else if (
      questionLower.includes("compliance") ||
      questionLower.includes("regulation") ||
      questionLower.includes("standard")
    ) {
      const complianceAnswers = Array.isArray(answer) ? answer : [answer];
      for (const comp of complianceAnswers) {
        const compLower = comp.toLowerCase();
        if (compLower.includes("soc")) context.complianceRequirements.push("soc2");
        if (compLower.includes("hipaa")) context.complianceRequirements.push("hipaa");
        if (compLower.includes("gdpr")) context.complianceRequirements.push("gdpr");
        if (compLower.includes("pci")) context.complianceRequirements.push("pci-dss");
        if (compLower.includes("iso")) context.complianceRequirements.push("iso27001");
      }
    } else if (
      questionLower.includes("concern") ||
      questionLower.includes("priority") ||
      questionLower.includes("focus")
    ) {
      const concernAnswers = Array.isArray(answer) ? answer : [answer];
      for (const concern of concernAnswers) {
        const concernLower = concern.toLowerCase();
        if (concernLower.includes("security")) context.primaryConcerns.push("security");
        if (concernLower.includes("performance")) context.primaryConcerns.push("performance");
        if (concernLower.includes("compliance")) context.primaryConcerns.push("compliance");
        if (concernLower.includes("cost")) context.primaryConcerns.push("cost");
        if (concernLower.includes("reliability")) context.primaryConcerns.push("reliability");
      }
    } else if (questionLower.includes("category") || questionLower.includes("area")) {
      const categoryAnswers = Array.isArray(answer) ? answer : [answer];
      context.priorityCategories.push(...categoryAnswers);
    } else {
      // Text/open-ended questions go to additionalContext
      if (typeof answer === "string") {
        context.additionalContext += (context.additionalContext ? "\n" : "") + answer;
      }
    }
  }

  // Ensure we have at least one primary concern
  if (context.primaryConcerns.length === 0) {
    context.primaryConcerns.push("security");
  }

  return context;
}

/**
 * Builds the prompt for the interviewer LLM.
 */
function buildInterviewerPrompt(signals: ProjectSignals, userQuery: string): string {
  return `## Project Signals
${JSON.stringify(signals, null, 2)}

## User Query (if provided)
${userQuery || "(No specific focus provided)"}

Based on these signals, determine if you have enough context for a targeted production-readiness analysis.
If the user query already specifies their focus (e.g., "security audit for HIPAA compliance"),
you may not need additional questions.

Generate interview questions only for information that is:
1. Not already clear from project signals
2. Not already specified in the user query
3. Important for tailoring the analysis`;
}

/**
 * Creates the interviewer node.
 * Evaluates whether project context is clear and asks follow-up questions via interrupt.
 *
 * This node uses a two-phase pattern to handle LangGraph's interrupt behavior:
 * - Phase 1: LLM evaluates signals and generates questions. If questions needed,
 *   store them in pendingInterviewQuestions and return (no interrupt yet). Graph loops back.
 * - Phase 2: Detect pendingInterviewQuestions, call interrupt() to get user answers.
 *   On resume, interrupt() returns the answers, which we process and clear pendingInterviewQuestions.
 *
 * This ensures the LLM is only called once per interview cycle.
 *
 * @param model - The chat model to use for interview question generation
 */
export function createInterviewerNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(InterviewerOutputSchema);

  return async (state: ProductionalizeStateType): Promise<Partial<ProductionalizeStateType>> => {
    // If not in interactive mode, skip interview entirely
    if (!state.interactiveMode) {
      logger.info("Non-interactive mode: skipping interview.");
      return {
        interviewComplete: true,
        userContext: inferContextFromSignals(state.signals, state.userQuery),
      };
    }

    // If interview is already complete, proceed
    if (state.interviewComplete) {
      logger.info("Interview complete, proceeding to analysis.");
      return {};
    }

    // Phase 2: We have pending questions - interrupt for user answers.
    // When interrupt() is called, execution stops. On resume, the node re-executes
    // from the beginning with the same state, but interrupt() returns the user's answers.
    if (state.pendingInterviewQuestions.length > 0) {
      logger.progress(
        `Asking ${String(state.pendingInterviewQuestions.length)} clarifying questions...`
      );

      const interruptPayload: InterviewInterruptPayload = {
        type: "interview",
        questions: state.pendingInterviewQuestions,
      };

      // First call: stops execution, returns questions to CLI
      // Resume call: returns the answers passed via Command({ resume: ... })
      const rawAnswers: unknown = interrupt(interruptPayload);

      // Validate that we received a record of answers
      if (typeof rawAnswers !== "object" || rawAnswers === null) {
        throw new Error("Invalid interrupt response: expected object with answers");
      }
      const answers = rawAnswers as Record<string, string | string[]>;

      // Parse answers into UserAnalysisContext
      const userContext = parseInterviewAnswers(answers, state.pendingInterviewQuestions);

      // Clear pending questions and mark interview complete
      return {
        userContext,
        interviewComplete: true,
        pendingInterviewQuestions: [],
      };
    }

    // Phase 1: Evaluate project signals clarity with LLM
    logger.progress("Analyzing project context...");

    // Build the prompt with current context
    const prompt = buildInterviewerPrompt(state.signals, state.userQuery);

    // Get structured output from LLM
    const result = await structuredModel.invoke([
      new SystemMessage(INTERVIEWER_TEMPLATE),
      new HumanMessage(prompt),
    ]);

    logger.info(`Interviewer reasoning: ${result.reasoning}`);

    // If satisfied, mark interview complete and infer context
    if (result.satisfied || result.questions.length === 0) {
      logger.success("Project signals provide sufficient context. Proceeding to analysis.");
      return {
        interviewComplete: true,
        userContext: inferContextFromSignals(state.signals, state.userQuery),
        pendingInterviewQuestions: [],
      };
    }

    // Store questions in state. Graph will loop back to this node,
    // and the next invocation will detect pendingInterviewQuestions and call interrupt().
    // This ensures we don't call the LLM again on resume.
    logger.info(`Generated ${String(result.questions.length)} interview questions.`);
    return {
      pendingInterviewQuestions: result.questions as InterviewQuestion[],
    };
  };
}
