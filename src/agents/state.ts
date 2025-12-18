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

export const AgentState = Annotation.Root({
  userQuery: Annotation<string>(),
  subtasks: Annotation<Subtask[]>({
    reducer: (current, update) => {
      const map = new Map(current.map((t) => [t.id, t]));
      update.forEach((t) => map.set(t.id, t));
      return Array.from(map.values());
    },
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  context: Annotation<CodeChunk[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),
  finalSpec: Annotation<string | undefined>(),
});

export type AgentStateType = typeof AgentState.State;
