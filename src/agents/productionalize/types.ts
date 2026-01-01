import type { SASTFinding } from "../tools/sast-scanner.js";

export interface CodeRef {
  filepath: string;
  lines: string;
  content: string;
}

export interface Finding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  complianceRefs: string[];
  evidence: {
    codeRefs: CodeRef[];
    links: string[];
    scanResults?: SASTFinding[];
  };
}

export interface ProductionalizeSubtask {
  id: string;
  category: string;
  query: string;
  source: "code" | "web" | "scan";
  status: "pending" | "complete";
  findings?: Finding[];
  result?: string;
}

// ============================================================================
// Interactive Mode Types
// ============================================================================

/**
 * User context gathered during the interactive interview phase.
 * Informs the planner and workers about user priorities and constraints.
 */
export interface UserAnalysisContext {
  primaryConcerns: ("security" | "performance" | "compliance" | "cost" | "reliability")[];
  deploymentTarget: "aws" | "gcp" | "azure" | "on-premises" | "hybrid" | null;
  complianceRequirements: ("soc2" | "hipaa" | "gdpr" | "pci-dss" | "iso27001")[];
  priorityCategories: string[];
  additionalContext: string;
}

/**
 * A question to ask the user during the interview phase.
 */
export interface InterviewQuestion {
  id: string;
  question: string;
  type: "select" | "multiselect" | "text";
  options?: string[];
  required: boolean;
}

/**
 * State for pending worker clarification (used in two-phase interrupt pattern).
 */
export interface WorkerClarificationState {
  subtaskId: string;
  category: string;
  findingContext: string;
  questions: string[];
}

// ============================================================================
// Interrupt Payload Types (Discriminated Union)
// ============================================================================

/**
 * Payload for interview phase interrupt.
 * CLI should display questions and collect user answers.
 */
export interface InterviewInterruptPayload {
  type: "interview";
  questions: InterviewQuestion[];
}

/**
 * Payload for worker clarification interrupt.
 * CLI should show finding context and collect clarification.
 */
export interface WorkerClarificationInterruptPayload {
  type: "worker_clarification";
  category: string;
  subtaskId: string;
  findingContext: string;
  questions: string[];
}

/**
 * Payload for report review interrupt.
 * CLI should display the report and get approval/feedback.
 */
export interface ReportReviewInterruptPayload {
  type: "report_review";
  report: string;
}

/**
 * Union of all interrupt payload types for productionalize workflow.
 */
export type ProductionalizeInterruptPayload =
  | InterviewInterruptPayload
  | WorkerClarificationInterruptPayload
  | ReportReviewInterruptPayload;
