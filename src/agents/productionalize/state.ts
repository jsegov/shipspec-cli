import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { ProjectSignals } from "../../core/analysis/project-signals.js";
import type { SASTFinding } from "../tools/sast-scanner.js";

export interface CodeRef {
  filepath: string;
  lines: string;
  content?: string;
}

export interface Finding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  evidence: {
    codeRefs?: CodeRef[];
    links?: string[];
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

export interface TaskmasterTask {
  id: number;
  title: string;
  description: string;
  status: "pending";
  priority: "high" | "medium" | "low";
  dependencies: number[];
  details: string;
  testStrategy: string;
  subtasks?: TaskmasterTask[];
}

export function subtasksReducer(current: ProductionalizeSubtask[], update: ProductionalizeSubtask[]): ProductionalizeSubtask[] {
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
  tasks: Annotation<TaskmasterTask[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),
});

export type ProductionalizeStateType = typeof ProductionalizeState.State;
