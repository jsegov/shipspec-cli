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
import type { RpcEvent, InterruptPayload, InterviewQuestion } from "../rpc/protocol.js";

export type Mode = "ask" | "plan";
export type Operation = "ask" | "planning" | "productionalize" | null;
export type MessageRole = "user" | "assistant" | "status" | "system";
export type PendingCommand =
  | "model.list"
  | "model.current"
  | "model.set"
  | "connect"
  | "planning.list"
  | "productionalize.list"
  | null;

export interface MessageMeta {
  isDocument?: boolean;
  docType?: "prd" | "spec" | "report";
  isQuestion?: boolean;
  questionNumber?: number;
  totalQuestions?: number;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
  meta?: MessageMeta;
}

export type InlineInteractionKind = "document_review" | "clarification" | "interview";

export interface InlineInteraction {
  id: string;
  kind: InlineInteractionKind;
  messageId: string;
  docType?: "prd" | "spec" | "report";
  questionIndex?: number;
  totalQuestions?: number;
  answers?: Record<string, string | string[]>;
  questions?: string[] | InterviewQuestion[];
  interviewQuestionId?: string;
  questionType?: "select" | "multiselect" | "text";
  options?: string[];
  resume: { type: "planning" | "productionalize"; id: string };
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

  // List operations
  requestPlanningList: () => void;
  requestProductionalizeList: () => void;

  // Streaming
  streamingMessageId: Accessor<string | null>;

  // Inline interactions
  pendingInteraction: Accessor<InlineInteraction | null>;
  handleInteractionResponse: (input: string) => boolean;
  hasActiveInteraction: () => boolean;
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

const PlanningListSchema = z.object({
  tracks: z.array(
    z.object({
      id: z.string(),
      phase: z.string(),
      initialIdea: z.string(),
      updatedAt: z.string(),
    })
  ),
});

const ProductionalizeListSchema = z.object({
  outputs: z.array(
    z.object({
      name: z.string(),
      timestamp: z.string(),
      type: z.literal("report"),
      size: z.number(),
    })
  ),
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

  // Inline interactions
  const [pendingInteraction, setPendingInteraction] = createSignal<InlineInteraction | null>(null);
  const [documentMessageIds, setDocumentMessageIds] = createSignal<{
    prd?: string;
    spec?: string;
    report?: string;
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

  // Formatting helpers for inline display
  const formatDocumentForTranscript = (
    title: string,
    content: string,
    instructions?: string
  ): string => {
    const header = `=== ${title} ===\n\n`;
    const footer = `\n\n---\n${instructions ?? "Type 'approve' or provide feedback to continue."}`;
    return header + content + footer;
  };

  const formatQuestionForTranscript = (
    type: string,
    question: string,
    current: number,
    total: number
  ): string => {
    return `[${type} ${String(current)}/${String(total)}]\n\n${question}`;
  };

  const formatInterviewQuestionForTranscript = (
    question: InterviewQuestion,
    current: number,
    total: number
  ): string => {
    let content = `[Production Interview ${String(current)}/${String(total)}]\n\n${question.question}`;
    if (question.options && question.options.length > 0) {
      content += "\n\nOptions:\n" + question.options.map((o) => `  - ${o}`).join("\n");
    }
    if (question.type === "multiselect") {
      content += "\n\n(Separate multiple selections with commas)";
    }
    return content;
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
    const resumeType = activeOperation() === "productionalize" ? "productionalize" : "planning";
    const resumeId =
      resumeType === "productionalize"
        ? (eventSessionId ?? activeSession().productionSessionId)
        : (eventTrackId ?? activeSession().planningTrackId);

    switch (payload.kind) {
      case "clarification": {
        if (!resumeId) {
          appendError("Missing session ID for clarification response.");
          return;
        }

        if (payload.questions.length === 0) {
          // No questions - auto-resume
          setIsProcessingSignal(true);
          if (resumeType === "planning") {
            rpc.send({ method: "planning.resume", params: { trackId: resumeId, response: {} } });
          } else {
            rpc.send({
              method: "productionalize.resume",
              params: { sessionId: resumeId, response: {} },
            });
          }
          return;
        }

        const interactionId = createId();
        const msgId = createId();

        // Display first question inline
        const questionContent = formatQuestionForTranscript(
          "Clarification",
          payload.questions[0] ?? "",
          1,
          payload.questions.length
        );

        appendMessage({
          id: msgId,
          role: "assistant",
          content: sanitizeForTerminal(questionContent),
          meta: {
            isQuestion: true,
            questionNumber: 1,
            totalQuestions: payload.questions.length,
          },
        });

        setPendingInteraction({
          id: interactionId,
          kind: "clarification",
          messageId: msgId,
          questionIndex: 0,
          totalQuestions: payload.questions.length,
          answers: {},
          questions: payload.questions,
          resume: { type: resumeType, id: resumeId },
        });
        return;
      }

      case "document_review": {
        if (!resumeId) {
          appendError("Missing session ID for review response.");
          return;
        }

        const docType = payload.docType;
        const existingMsgId = documentMessageIds()[docType];
        const interactionId = createId();

        // Format content with header
        const docTitle =
          docType === "prd" ? "PRD" : docType === "spec" ? "Technical Specification" : "Report";
        const formattedContent = formatDocumentForTranscript(
          docTitle,
          payload.content,
          payload.instructions
        );

        if (existingMsgId) {
          // In-place update
          updateMessage(existingMsgId, (m) => ({
            ...m,
            content: sanitizeForTerminal(formattedContent),
          }));

          setPendingInteraction({
            id: interactionId,
            kind: "document_review",
            messageId: existingMsgId,
            docType,
            resume: { type: resumeType, id: resumeId },
          });
        } else {
          // New message
          const msgId = createId();
          appendMessage({
            id: msgId,
            role: "assistant",
            content: sanitizeForTerminal(formattedContent),
            meta: {
              isDocument: true,
              docType,
            },
          });
          setDocumentMessageIds((prev) => ({ ...prev, [docType]: msgId }));

          setPendingInteraction({
            id: interactionId,
            kind: "document_review",
            messageId: msgId,
            docType,
            resume: { type: resumeType, id: resumeId },
          });
        }
        return;
      }

      case "interview": {
        const interviewResumeId = eventSessionId ?? activeSession().productionSessionId;
        if (!interviewResumeId) {
          appendError("Missing session ID for interview response.");
          return;
        }

        // If questions array is empty, immediately send empty response to unblock backend
        if (payload.questions.length === 0) {
          setIsProcessingSignal(true);
          rpc.send({
            method: "productionalize.resume",
            params: { sessionId: interviewResumeId, response: {} },
          });
          return;
        }

        // We know questions is non-empty from the check above
        const firstQ = payload.questions[0];

        const interactionId = createId();
        const msgId = createId();

        const questionContent = formatInterviewQuestionForTranscript(
          firstQ,
          1,
          payload.questions.length
        );

        appendMessage({
          id: msgId,
          role: "assistant",
          content: sanitizeForTerminal(questionContent),
          meta: {
            isQuestion: true,
            questionNumber: 1,
            totalQuestions: payload.questions.length,
          },
        });

        setPendingInteraction({
          id: interactionId,
          kind: "interview",
          messageId: msgId,
          questionIndex: 0,
          totalQuestions: payload.questions.length,
          answers: {},
          questions: payload.questions,
          interviewQuestionId: firstQ.id,
          questionType: firstQ.type,
          options: firstQ.options,
          resume: { type: "productionalize", id: interviewResumeId },
        });
        return;
      }
    }
  };

  // Handle user responses to inline interactions
  const handleInteractionResponse = (input: string): boolean => {
    const interaction = pendingInteraction();
    if (!interaction) return false;

    // Add user's response as a message
    appendMessage({
      id: createId(),
      role: "user",
      content: sanitizeForTerminal(input),
    });

    switch (interaction.kind) {
      case "document_review": {
        // Send response to backend
        setPendingInteraction(null);
        setIsProcessingSignal(true);

        if (interaction.resume.type === "planning") {
          rpc.send({
            method: "planning.resume",
            params: { trackId: interaction.resume.id, response: input },
          });
        } else {
          rpc.send({
            method: "productionalize.resume",
            params: { sessionId: interaction.resume.id, response: input },
          });
        }
        return true;
      }

      case "clarification": {
        const questions = interaction.questions as string[];
        const currentIndex = interaction.questionIndex ?? 0;
        const answers = { ...interaction.answers, [String(currentIndex)]: input };

        if (currentIndex + 1 >= (interaction.totalQuestions ?? 0)) {
          // All questions answered
          setPendingInteraction(null);
          setIsProcessingSignal(true);

          if (interaction.resume.type === "planning") {
            rpc.send({
              method: "planning.resume",
              params: { trackId: interaction.resume.id, response: answers },
            });
          } else {
            rpc.send({
              method: "productionalize.resume",
              params: { sessionId: interaction.resume.id, response: answers },
            });
          }
        } else {
          // Show next question
          const nextIndex = currentIndex + 1;
          const nextQuestion = questions[nextIndex] ?? "";
          const msgId = createId();

          appendMessage({
            id: msgId,
            role: "assistant",
            content: sanitizeForTerminal(
              formatQuestionForTranscript(
                "Clarification",
                nextQuestion,
                nextIndex + 1,
                questions.length
              )
            ),
            meta: {
              isQuestion: true,
              questionNumber: nextIndex + 1,
              totalQuestions: questions.length,
            },
          });

          setPendingInteraction({
            ...interaction,
            messageId: msgId,
            questionIndex: nextIndex,
            answers,
          });
        }
        return true;
      }

      case "interview": {
        const questions = interaction.questions as InterviewQuestion[];
        const currentIndex = interaction.questionIndex ?? 0;
        // Safe: we control the index and it's always within bounds
        const currentQ = questions[currentIndex];

        const answer =
          currentQ.type === "multiselect"
            ? input
                .split(",")
                .map((e) => e.trim())
                .filter(Boolean)
            : input;

        const answers = { ...interaction.answers, [currentQ.id]: answer };

        if (currentIndex + 1 >= (interaction.totalQuestions ?? 0)) {
          // All questions answered
          setPendingInteraction(null);
          setIsProcessingSignal(true);
          rpc.send({
            method: "productionalize.resume",
            params: { sessionId: interaction.resume.id, response: answers },
          });
        } else {
          // Show next question
          const nextIndex = currentIndex + 1;
          // Safe: we only get here when nextIndex < totalQuestions
          const nextQ = questions[nextIndex];

          const msgId = createId();

          appendMessage({
            id: msgId,
            role: "assistant",
            content: sanitizeForTerminal(
              formatInterviewQuestionForTranscript(nextQ, nextIndex + 1, questions.length)
            ),
            meta: {
              isQuestion: true,
              questionNumber: nextIndex + 1,
              totalQuestions: questions.length,
            },
          });

          setPendingInteraction({
            ...interaction,
            messageId: msgId,
            questionIndex: nextIndex,
            answers,
            interviewQuestionId: nextQ.id,
            questionType: nextQ.type,
            options: nextQ.options,
          });
        }
        return true;
      }
    }

    return false;
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
      case "planning.list": {
        const parsed = PlanningListSchema.safeParse(result);
        if (!parsed.success) {
          appendError("Failed to load planning tracks.");
          return;
        }
        if (parsed.data.tracks.length === 0) {
          appendStatus("No planning tracks found.");
          return;
        }
        const lines = parsed.data.tracks.map(
          (t) => `• ${t.id} [${t.phase}] - ${t.initialIdea || "(no description)"}`
        );
        appendMessage({
          id: createId(),
          role: "system",
          content: sanitizeForTerminal(`Planning Tracks:\n${lines.join("\n")}`),
        });
        return;
      }
      case "productionalize.list": {
        const parsed = ProductionalizeListSchema.safeParse(result);
        if (!parsed.success) {
          appendError("Failed to load production reports.");
          return;
        }
        if (parsed.data.outputs.length === 0) {
          appendStatus("No production reports found.");
          return;
        }
        const lines = parsed.data.outputs.map(
          (o) => `• ${o.name} (${String(Math.round(o.size / 1024))}KB)`
        );
        appendMessage({
          id: createId(),
          role: "system",
          content: sanitizeForTerminal(`Production Reports:\n${lines.join("\n")}`),
        });
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
      setPendingInteraction(null);
      setDocumentMessageIds({});
      setPendingCommand(null);
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

  const requestPlanningList = () => {
    if (isProcessing()) return;
    setPendingCommand("planning.list");
    setIsProcessingSignal(true);
    rpc.send({ method: "planning.list" });
  };

  const requestProductionalizeList = () => {
    if (isProcessing()) return;
    setPendingCommand("productionalize.list");
    setIsProcessingSignal(true);
    rpc.send({ method: "productionalize.list" });
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
        requestPlanningList,
        requestProductionalizeList,
        streamingMessageId,
        pendingInteraction,
        handleInteractionResponse,
        hasActiveInteraction: () => pendingInteraction() !== null,
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
