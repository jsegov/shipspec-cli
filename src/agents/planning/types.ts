/**
 * Type definitions for the planning command.
 * Defines interfaces for planning state, interrupt payloads, and track metadata.
 */

/**
 * Planning phase states for the workflow.
 */
export type PlanningPhase = "clarifying" | "prd_review" | "spec_review" | "complete";

/**
 * Clarification Q&A entry.
 */
export interface ClarificationEntry {
  question: string;
  answer: string;
}

/**
 * Interrupt payload types for human-in-the-loop interactions.
 */
export type InterruptType = "clarification" | "prd_review" | "spec_review";

/**
 * Base interrupt payload structure.
 */
export interface BaseInterruptPayload {
  type: InterruptType;
}

/**
 * Clarification interrupt payload - prompts user for answers to questions.
 */
export interface ClarificationInterruptPayload extends BaseInterruptPayload {
  type: "clarification";
  questions: string[];
}

/**
 * Document review interrupt payload - prompts user to approve or provide feedback.
 */
export interface DocumentReviewInterruptPayload extends BaseInterruptPayload {
  type: "prd_review" | "spec_review";
  document: string;
  instructions: string;
}

/**
 * Union type for all interrupt payloads.
 */
export type InterruptPayload = ClarificationInterruptPayload | DocumentReviewInterruptPayload;

/**
 * Track metadata stored in track.json.
 * Tracks the planning session state for resumption.
 */
export interface TrackMetadata {
  id: string;
  createdAt: string;
  updatedAt: string;
  phase: PlanningPhase;
  initialIdea: string;
  prdApproved: boolean;
  specApproved: boolean;
}

/**
 * CLI options for the planning command.
 */
export interface PlanningOptions {
  track?: string;
  checkpoint: boolean;
  reindex: boolean;
  noSave: boolean;
  cloudOk: boolean;
  localOnly: boolean;
}
