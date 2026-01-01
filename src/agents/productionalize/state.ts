import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { ProjectSignals } from "../../core/analysis/project-signals.js";
import type { SASTFinding } from "../tools/sast-scanner.js";
import type {
  Finding,
  ProductionalizeSubtask,
  UserAnalysisContext,
  InterviewQuestion,
  WorkerClarificationState,
} from "./types.js";

export function subtasksReducer(
  current: ProductionalizeSubtask[],
  update: ProductionalizeSubtask[]
): ProductionalizeSubtask[] {
  const map = new Map(current.map((t) => [t.id, t]));
  update.forEach((t) => map.set(t.id, t));
  return Array.from(map.values());
}

export function findingsReducer(current: Finding[], update: Finding[]): Finding[] {
  const map = new Map(current.map((f) => [f.id, f]));
  update.forEach((f) => map.set(f.id, f));
  return Array.from(map.values());
}

export function messagesReducer(x: BaseMessage[], y: BaseMessage[]): BaseMessage[] {
  return x.concat(y);
}

export const ProductionalizeState = Annotation.Root({
  userQuery: Annotation<string>(),
  signals: Annotation<ProjectSignals>(),
  researchDigest: Annotation<string>(),
  sastResults: Annotation<SASTFinding[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),
  subtasks: Annotation<ProductionalizeSubtask[]>({
    reducer: subtasksReducer,
    default: () => [],
  }),
  findings: Annotation<Finding[]>({
    reducer: findingsReducer,
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesReducer,
    default: () => [],
  }),
  finalReport: Annotation<string>(),
  subtask: Annotation<ProductionalizeSubtask>({
    reducer: (_x, y) => y,
  }),
  taskPrompts: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),

  // ============================================================================
  // Interactive Mode State
  // ============================================================================

  /** Whether interactive mode is enabled (default: true). */
  interactiveMode: Annotation<boolean>({
    reducer: (_x, y) => y,
    default: () => true,
  }),

  // Interview Phase
  /** User context gathered during interview phase. */
  userContext: Annotation<UserAnalysisContext | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  /** Whether the interview phase is complete. */
  interviewComplete: Annotation<boolean>({
    reducer: (_x, y) => y,
    default: () => false,
  }),
  /** Pending interview questions (two-phase interrupt pattern). */
  pendingInterviewQuestions: Annotation<InterviewQuestion[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),

  // Worker Clarification Phase
  // NOTE: These fields are currently UNUSED because workers don't call interrupt().
  // Workers run in parallel via Send(), which makes interrupt() unsuitable:
  // - Multiple workers calling interrupt() simultaneously causes routing issues
  // - Last-write-wins reducers would clobber concurrent clarification state
  // - There's no loop-back edge to handle worker clarification interrupts
  // Fields are kept for potential future use with a different architecture.
  /** Pending worker clarification state (two-phase interrupt pattern). */
  pendingWorkerClarification: Annotation<WorkerClarificationState | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),
  /** User clarification answers for worker nodes (keyed by question). */
  clarificationAnswers: Annotation<Record<string, string> | null>({
    reducer: (_x, y) => y,
    default: () => null,
  }),

  // Report Review Phase
  /** Whether the report has been approved by the user. */
  reportApproved: Annotation<boolean>({
    reducer: (_x, y) => y,
    default: () => false,
  }),
  /** User feedback on the report (triggers regeneration if provided). */
  reportFeedback: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => "",
  }),
  /** Flag set by aggregator when a new report is generated that needs review. */
  reportNeedsReview: Annotation<boolean>({
    reducer: (_x, y) => y,
    default: () => false,
  }),
});

export type ProductionalizeStateType = typeof ProductionalizeState.State;
