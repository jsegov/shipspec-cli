import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { CodeChunk } from "../core/types/index.js";

export interface Subtask {
  id: string;
  query: string;
  status: "pending" | "in_progress" | "complete";
  result?: string;
  retrievedContext?: CodeChunk[];
}

export function subtasksReducer(current: Subtask[], update: Subtask[]): Subtask[] {
  const map = new Map(current.map((t) => [t.id, t]));
  update.forEach((t) => map.set(t.id, t));
  return Array.from(map.values());
}

export function messagesReducer(x: BaseMessage[], y: BaseMessage[]): BaseMessage[] {
  return x.concat(y);
}

export function contextReducer(x: CodeChunk[], y: CodeChunk[]): CodeChunk[] {
  return [...x, ...y];
}

export const AgentState = Annotation.Root({
  userQuery: Annotation<string>(),
  subtasks: Annotation<Subtask[]>({
    reducer: subtasksReducer,
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesReducer,
    default: () => [],
  }),
  context: Annotation<CodeChunk[]>({
    reducer: contextReducer,
    default: () => [],
  }),
  finalSpec: Annotation<string | undefined>(),
});

export type AgentStateType = typeof AgentState.State;
