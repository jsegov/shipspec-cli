import {
  createContext,
  useContext,
  createSignal,
  batch,
  onMount,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { z } from "zod";
import { useRpc } from "./rpc-provider.js";
import { useDialog } from "./dialog-provider.js";
import { useToast } from "./toast-provider.js";
import { createId } from "../utils/id.js";
import { sanitizeForTerminal } from "../../../src/utils/terminal-sanitize.js";
import type { RpcEvent, InterruptPayload } from "../rpc/protocol.js";

export type Mode = "ask" | "plan";
export type Operation = "ask" | "planning" | "productionalize" | null;
export type MessageRole = "user" | "assistant" | "status" | "system";
export type PendingCommand = "model.list" | "model.current" | "model.set" | "connect" | null;

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
}

export interface AskHistoryEntry {
  question: string;
  answer: string;
}

interface SessionContextValue {
  // Mode
  mode: Accessor<Mode>;
  setMode: (mode: Mode) => void;
  toggleMode: () => void;

  // Messages
  messages: Accessor<Message[]>;
  appendMessage: (message: Message) => void;
  appendStatus: (content: string) => void;
  appendError: (content: string) => void;
  updateMessage: (id: string, updater: (m: Message) => Message) => void;
  clearMessages: () => void;

  // Processing state
  isProcessing: Accessor<boolean>;
  setIsProcessing: (value: boolean) => void;
  activeOperation: Accessor<Operation>;

  // Input history
  inputHistory: Accessor<string[]>;
  pushHistory: (entry: string) => void;
  getHistoryAt: (index: number) => string | undefined;
  historyLength: Accessor<number>;

  // Ask history (for RAG context)
  askHistory: Accessor<AskHistoryEntry[]>;

  // Current model
  currentModel: Accessor<string>;

  // Operations
  sendAsk: (question: string) => void;
  sendPlanning: (idea: string) => void;
  sendProductionalize: (context?: string) => void;
  cancelAsk: () => void;

  // Pending command
  pendingCommand: Accessor<PendingCommand>;
  setPendingCommand: (cmd: PendingCommand) => void;

  // Model operations
  requestModelList: () => void;
  requestModelCurrent: () => void;
  requestModelSet: (model: string) => void;

  // Connect operation
  sendConnect: (openrouterKey: string, tavilyKey?: string) => void;

  // Streaming
  streamingMessageId: Accessor<string | null>;
}

const SessionContext = createContext<SessionContextValue>();

// Schema validators
const AskResultSchema = z.object({
  answer: z.string(),
  noContext: z.boolean().optional(),
});

const PlanningResultSchema = z.object({
  trackId: z.string(),
  trackDir: z.string(),
  phase: z.string(),
  prd: z.string().nullable().optional(),
  techSpec: z.string().nullable().optional(),
  taskPrompts: z.string().nullable().optional(),
});

const ProductionalizeResultSchema = z.object({
  sessionId: z.string(),
  finalReport: z.string(),
  taskPrompts: z.string(),
});

const ModelListSchema = z.array(
  z.object({
    alias: z.string(),
    name: z.string(),
  })
);

const ModelCurrentSchema = z.object({
  model: z.string(),
});

const ConnectResultSchema = z.object({
  projectRoot: z.string(),
  projectId: z.string(),
  initializedAt: z.string(),
});

export const SessionProvider: ParentComponent = (props) => {
  const rpc = useRpc();
  const dialog = useDialog();
  const toast = useToast();

  // Core state
  const [mode, setModeSignal] = createSignal<Mode>("ask");
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [isProcessing, setIsProcessingSignal] = createSignal(false);
  const [activeOperation, setActiveOperation] = createSignal<Operation>(null);
  const [currentModel, setCurrentModel] = createSignal("gemini-flash");

  // History
  const [inputHistory, setInputHistory] = createSignal<string[]>([]);
  const [askHistory, setAskHistory] = createSignal<AskHistoryEntry[]>([]);

  // Streaming
  const [streamingMessageId, setStreamingMessageId] = createSignal<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = createSignal<string | null>(null);

  // Pending command
  const [pendingCommand, setPendingCommand] = createSignal<PendingCommand>(null);

  // Session IDs
  const [activeSession, setActiveSession] = createSignal<{
    planningTrackId?: string;
    productionSessionId?: string;
  }>({});

  // Token buffering for performance
  let tokenBuffer = "";
  let flushScheduled = false;

  const flushTokenBuffer = () => {
    if (!tokenBuffer) return;
    const content = tokenBuffer;
    tokenBuffer = "";
    flushScheduled = false;

    const msgId = streamingMessageId();
    if (!msgId) {
      const newId = createId();
      setStreamingMessageId(newId);
      appendMessage({
        id: newId,
        role: "assistant",
        content: sanitizeForTerminal(content),
        streaming: true,
      });
      return;
    }

    updateMessage(msgId, (m) => ({
      ...m,
      content: m.content + sanitizeForTerminal(content),
    }));
  };

  const handleToken = (content: string) => {
    tokenBuffer += content;
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushTokenBuffer);
    }
  };

  // RPC event handling
  onMount(() => {
    rpc.onEvent(handleRpcEvent);

    // Fetch current model on mount
    requestModelCurrent();
  });

  const handleRpcEvent = (event: RpcEvent) => {
    switch (event.type) {
      case "status":
        // Surface status messages for planning/productionalize (not ask which uses streaming)
        if (activeOperation() !== "ask") {
          appendStatus(event.message);
        }
        return;
      case "progress":
        appendStatus(`${event.stage}${event.percent ? ` (${String(event.percent)}%)` : ""}`);
        return;
      case "token":
        handleToken(event.content);
        return;
      case "interrupt":
        setIsProcessingSignal(false);
        // Capture trackId/sessionId from the interrupt event if provided
        if (event.trackId && activeOperation() === "planning") {
          setActiveSession((prev) => ({ ...prev, planningTrackId: event.trackId }));
        }
        if (event.sessionId && activeOperation() === "productionalize") {
          setActiveSession((prev) => ({ ...prev, productionSessionId: event.sessionId }));
        }
        handleInterrupt(event.payload, event.trackId, event.sessionId);
        return;
      case "complete":
        setIsProcessingSignal(false);
        handleComplete(event.result);
        return;
      case "error":
        setIsProcessingSignal(false);
        appendError(event.message);
        resetSession();
        return;
    }
  };

  const handleInterrupt = (
    payload: InterruptPayload,
    eventTrackId?: string,
    eventSessionId?: string
  ) => {
    switch (payload.kind) {
      case "clarification": {
        const resumeType = activeOperation() === "productionalize" ? "productionalize" : "planning";
        // Use event-provided ID if available, fall back to activeSession
        const resumeId =
          resumeType === "productionalize"
            ? (eventSessionId ?? activeSession().productionSessionId)
            : (eventTrackId ?? activeSession().planningTrackId);

        if (!resumeId) {
          appendError("Missing session ID for clarification response.");
          return;
        }

        dialog.open({
          kind: "clarification",
          questions: payload.questions,
          answers: {},
          index: 0,
          resume: { type: resumeType, id: resumeId },
        });
        return;
      }
      case "document_review": {
        const resumeType = activeOperation() === "productionalize" ? "productionalize" : "planning";
        // Use event-provided ID if available, fall back to activeSession
        const resumeId =
          resumeType === "productionalize"
            ? (eventSessionId ?? activeSession().productionSessionId)
            : (eventTrackId ?? activeSession().planningTrackId);

        if (!resumeId) {
          appendError("Missing session ID for review response.");
          return;
        }

        dialog.open({
          kind: "review",
          docType: payload.docType,
          content: payload.content,
          instructions: payload.instructions,
          resume: { type: resumeType, id: resumeId },
        });
        return;
      }
      case "interview": {
        // Use event-provided ID if available, fall back to activeSession
        const resumeId = eventSessionId ?? activeSession().productionSessionId;
        if (!resumeId) {
          appendError("Missing session ID for interview response.");
          return;
        }
        // If questions array is empty, immediately send empty response to unblock backend
        if (payload.questions.length === 0) {
          setIsProcessingSignal(true);
          rpc.send({
            method: "productionalize.resume",
            params: { sessionId: resumeId, response: {} },
          });
          return;
        }
        dialog.open({
          kind: "interview",
          questions: payload.questions,
          answers: {},
          index: 0,
          resume: { type: "productionalize", id: resumeId },
        });
        return;
      }
    }
  };

  const handleComplete = (result: unknown) => {
    const pending = pendingCommand();
    if (pending) {
      handlePendingCommand(pending, result);
      setPendingCommand(null);
      return;
    }

    const op = activeOperation();

    if (op === "ask") {
      const parsed = AskResultSchema.safeParse(result);
      if (!parsed.success) {
        appendError("Unexpected ask response.");
        return;
      }
      const answer = parsed.data.answer;
      const question = currentQuestion();
      if (question) {
        setAskHistory((prev) => [...prev, { question, answer }]);
      }
      const msgId = streamingMessageId();
      if (msgId) {
        updateMessage(msgId, (m) => ({
          ...m,
          streaming: false,
          content: m.content || sanitizeForTerminal(answer),
        }));
      }
      resetSession();
      return;
    }

    if (op === "planning") {
      const parsed = PlanningResultSchema.safeParse(result);
      if (!parsed.success) {
        appendError("Unexpected planning response.");
        return;
      }
      appendMessage({
        id: createId(),
        role: "assistant",
        content: sanitizeForTerminal(
          `Planning complete. Track ${parsed.data.trackId} saved to ${parsed.data.trackDir}.`
        ),
      });
      toast.show(`Planning complete: ${parsed.data.trackId}`, "success");
      resetSession();
      return;
    }

    if (op === "productionalize") {
      const parsed = ProductionalizeResultSchema.safeParse(result);
      if (!parsed.success) {
        appendError("Unexpected productionalize response.");
        return;
      }
      appendMessage({
        id: createId(),
        role: "assistant",
        content: sanitizeForTerminal(parsed.data.finalReport),
      });
      appendMessage({
        id: createId(),
        role: "assistant",
        content: sanitizeForTerminal(parsed.data.taskPrompts),
      });
      toast.show("Production readiness review complete", "success");
      resetSession();
      return;
    }
  };

  const handlePendingCommand = (command: NonNullable<PendingCommand>, result: unknown) => {
    switch (command) {
      case "model.list": {
        const parsed = ModelListSchema.safeParse(result);
        if (!parsed.success) {
          appendError("Failed to load model list.");
          return;
        }
        dialog.open({ kind: "model", models: parsed.data });
        return;
      }
      case "model.current": {
        const parsed = ModelCurrentSchema.safeParse(result);
        if (parsed.success) {
          setCurrentModel(parsed.data.model);
        }
        return;
      }
      case "model.set": {
        const parsed = ModelCurrentSchema.safeParse(result);
        if (parsed.success) {
          setCurrentModel(parsed.data.model);
          appendStatus(`Model set to ${parsed.data.model}`);
        }
        return;
      }
      case "connect": {
        const parsed = ConnectResultSchema.safeParse(result);
        if (parsed.success) {
          appendStatus(`Connected: ${parsed.data.projectRoot}`);
        } else {
          appendError("Failed to save API keys.");
        }
        return;
      }
    }
  };

  const resetSession = () => {
    batch(() => {
      setStreamingMessageId(null);
      setCurrentQuestion(null);
      setActiveOperation(null);
      setActiveSession({});
    });
  };

  // Public API
  const setMode = (m: Mode) => setModeSignal(m);
  const toggleMode = () => setModeSignal((prev) => (prev === "ask" ? "plan" : "ask"));

  const appendMessage = (message: Message) => {
    setMessages((prev) => [...prev, message]);
  };

  const appendStatus = (content: string) => {
    appendMessage({
      id: createId(),
      role: "status",
      content: sanitizeForTerminal(content),
    });
  };

  const appendError = (content: string) => {
    appendMessage({
      id: createId(),
      role: "system",
      content: sanitizeForTerminal(content),
    });
  };

  const updateMessage = (id: string, updater: (m: Message) => Message) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  };

  const clearMessages = () => {
    batch(() => {
      setMessages([]);
      setAskHistory([]);
      setInputHistory([]);
    });
  };

  const setIsProcessing = (value: boolean) => setIsProcessingSignal(value);

  const pushHistory = (entry: string) => {
    setInputHistory((prev) => [...prev, entry]);
  };

  const getHistoryAt = (index: number) => inputHistory()[index];
  const historyLength = () => inputHistory().length;

  const sendAsk = (question: string) => {
    setActiveOperation("ask");
    setIsProcessingSignal(true);
    setCurrentQuestion(question);

    const msgId = createId();
    setStreamingMessageId(msgId);

    appendMessage({
      id: createId(),
      role: "user",
      content: sanitizeForTerminal(question),
    });
    appendMessage({ id: msgId, role: "assistant", content: "", streaming: true });

    rpc.send({
      method: "ask.start",
      params: { question, history: askHistory() },
    });
  };

  const sendPlanning = (idea: string) => {
    // Only pass trackId to backend if we're resuming an existing session.
    // For NEW sessions, let the backend generate the trackId.
    const existingTrackId = activeSession().planningTrackId;
    setActiveOperation("planning");
    setIsProcessingSignal(true);

    appendMessage({
      id: createId(),
      role: "user",
      content: sanitizeForTerminal(idea),
    });

    rpc.send({
      method: "planning.start",
      params: { idea, trackId: existingTrackId },
    });
  };

  const sendProductionalize = (context?: string) => {
    const sessionId = activeSession().productionSessionId ?? createId();
    setActiveSession((prev) => ({ ...prev, productionSessionId: sessionId }));
    setActiveOperation("productionalize");
    setIsProcessingSignal(true);

    appendMessage({
      id: createId(),
      role: "user",
      content: sanitizeForTerminal(
        context ? `Production readiness: ${context}` : "Production readiness review"
      ),
    });

    rpc.send({
      method: "productionalize.start",
      params: { context, sessionId },
    });
  };

  const cancelAsk = () => {
    if (activeOperation() === "ask") {
      rpc.send({ method: "ask.cancel" });
    }
  };

  const requestModelList = () => {
    if (isProcessing()) return;
    setIsProcessingSignal(true);
    setPendingCommand("model.list");
    rpc.send({ method: "model.list" });
  };

  const requestModelCurrent = () => {
    setPendingCommand("model.current");
    rpc.send({ method: "model.current" });
  };

  const requestModelSet = (model: string) => {
    if (!model) return;
    setIsProcessingSignal(true);
    setPendingCommand("model.set");
    rpc.send({ method: "model.set", params: { model } });
  };

  const sendConnect = (openrouterKey: string, tavilyKey?: string) => {
    setPendingCommand("connect");
    setIsProcessingSignal(true);
    rpc.send({
      method: "connect",
      params: { openrouterKey, tavilyKey },
    });
  };

  return (
    <SessionContext.Provider
      value={{
        mode,
        setMode,
        toggleMode,
        messages,
        appendMessage,
        appendStatus,
        appendError,
        updateMessage,
        clearMessages,
        isProcessing,
        setIsProcessing,
        activeOperation,
        inputHistory,
        pushHistory,
        getHistoryAt,
        historyLength,
        askHistory,
        currentModel,
        sendAsk,
        sendPlanning,
        sendProductionalize,
        cancelAsk,
        pendingCommand,
        setPendingCommand,
        requestModelList,
        requestModelCurrent,
        requestModelSet,
        sendConnect,
        streamingMessageId,
      }}
    >
      {props.children}
    </SessionContext.Provider>
  );
};

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
