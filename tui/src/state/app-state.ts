import { createSignal } from "solid-js";

export type Mode = "ask" | "plan";

export type MessageRole = "user" | "assistant" | "status" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
}

export type DialogState =
  | { kind: "none" }
  | {
      kind: "connect";
      step: "openrouter" | "tavily";
      openrouterKey: string;
      tavilyKey: string;
    }
  | {
      kind: "model";
      models: { alias: string; name: string }[];
    }
  | {
      kind: "clarification";
      questions: string[];
      answers: Record<string, string>;
      index: number;
      resume: { type: "planning" | "productionalize"; id: string };
    }
  | {
      kind: "interview";
      questions: {
        id: string;
        question: string;
        type: "select" | "multiselect" | "text";
        options?: string[];
        required: boolean;
      }[];
      answers: Record<string, string | string[]>;
      index: number;
      resume: { type: "productionalize"; id: string };
    }
  | {
      kind: "review";
      docType: "prd" | "spec" | "report";
      content: string;
      instructions?: string;
      resume: { type: "planning" | "productionalize"; id: string };
    };

export const [mode, setMode] = createSignal<Mode>("ask");
export const [messages, setMessages] = createSignal<Message[]>([]);
export const [inputValue, setInputValue] = createSignal("");
export const [rawInputValue, setRawInputValue] = createSignal("");
export const [isProcessing, setIsProcessing] = createSignal(false);
export const [currentModel, setCurrentModel] = createSignal("gemini-flash");
export const [activeDialog, setActiveDialog] = createSignal<DialogState>({ kind: "none" });
export const [inputHistory, setInputHistory] = createSignal<string[]>([]);
export const [historyIndex, setHistoryIndex] = createSignal(-1);
export const [activeOperation, setActiveOperation] = createSignal<
  "ask" | "planning" | "productionalize" | null
>(null);
export const [pendingCommand, setPendingCommand] = createSignal<
  "model.list" | "model.current" | "model.set" | "connect" | null
>(null);
export const [askHistory, setAskHistory] = createSignal<{ question: string; answer: string }[]>([]);
export const [activeSession, setActiveSession] = createSignal<{
  planningTrackId?: string;
  productionSessionId?: string;
}>({});
export const [streamingMessageId, setStreamingMessageId] = createSignal<string | null>(null);
export const [currentQuestion, setCurrentQuestion] = createSignal<string | null>(null);
