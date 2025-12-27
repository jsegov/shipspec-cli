/**
 * Planning state schema using LangGraph Annotation API.
 * Follows the same pattern as productionalize/state.ts.
 */

import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { ProjectSignals } from "../../core/analysis/project-signals.js";
import type { ClarificationEntry, PlanningPhase } from "./types.js";

/**
 * Reducer for clarification history - appends new entries.
 */
export function clarificationHistoryReducer(
  current: ClarificationEntry[],
  update: ClarificationEntry[]
): ClarificationEntry[] {
  return [...current, ...update];
}

/**
 * Reducer for messages - concatenates new messages.
 */
export function messagesReducer(x: BaseMessage[], y: BaseMessage[]): BaseMessage[] {
  return x.concat(y);
}

/**
 * Planning state Annotation schema.
 * Manages all state for the planning workflow including user input,
 * phase tracking, generated documents, and conversation history.
 */
export const PlanningState = Annotation.Root({
  // User input
  initialIdea: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),

  // Phase tracking
  phase: Annotation<PlanningPhase>({
    reducer: (_x, y) => y,
    default: () => "clarifying" as const,
  }),

  // Context from codebase
  signals: Annotation<ProjectSignals | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  codeContext: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),

  // Clarification
  clarificationHistory: Annotation<ClarificationEntry[]>({
    reducer: clarificationHistoryReducer,
    default: () => [],
  }),
  clarificationComplete: Annotation<boolean>({
    reducer: (_x, y) => y,
    default: () => false,
  }),
  // Pending questions from interrupt (used to detect resume)
  pendingQuestions: Annotation<string[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),

  // Pending documents awaiting review (two-phase interrupt pattern)
  // These store generated documents before interrupt() to prevent regeneration on resume
  pendingPrd: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  pendingTechSpec: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),

  // Documents
  prd: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  techSpec: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  taskPrompts: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),

  // User feedback (populated on resume after interrupt)
  userFeedback: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),

  // Conversation messages
  messages: Annotation<BaseMessage[]>({
    reducer: messagesReducer,
    default: () => [],
  }),
});

/**
 * Type alias for the planning state.
 */
export type PlanningStateType = typeof PlanningState.State;
