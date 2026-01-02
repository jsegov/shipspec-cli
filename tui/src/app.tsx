import { Portal } from "@opentui/solid";
import { onCleanup, onMount } from "solid-js";
import { z } from "zod";

import { RpcClient } from "./rpc/client.js";
import { findSlashCommand, slashCommands } from "./commands/registry.js";
import { useAppKeybinds } from "./keybinds/index.js";
import { sanitizeForTerminal } from "../../src/utils/terminal-sanitize.js";
import { createId } from "./utils/id.js";
import {
  activeDialog,
  activeOperation,
  activeSession,
  askHistory,
  currentModel,
  currentQuestion,
  historyIndex,
  inputHistory,
  inputValue,
  isProcessing,
  messages,
  mode,
  pendingCommand,
  rawInputValue,
  setActiveDialog,
  setActiveOperation,
  setActiveSession,
  setAskHistory,
  setCurrentModel,
  setCurrentQuestion,
  setHistoryIndex,
  setInputHistory,
  setInputValue,
  setIsProcessing,
  setMode,
  setMessages,
  setPendingCommand,
  setRawInputValue,
  setStreamingMessageId,
  streamingMessageId,
} from "./state/app-state.js";
import type { Message } from "./state/app-state.js";
import type { InterruptPayload, RpcEvent } from "./rpc/protocol.js";
import { Header } from "./components/layout/header.js";
import { Transcript } from "./components/layout/transcript.js";
import { Prompt } from "./components/layout/prompt.js";
import { ConnectWizard } from "./components/dialogs/connect-wizard.js";
import { ModelSelector } from "./components/dialogs/model-selector.js";
import { ReviewDialog } from "./components/dialogs/review-dialog.js";
import { Questionnaire } from "./components/forms/questionnaire.js";

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

const isMaskedInput = () => activeDialog().kind === "connect";

function appendMessage(message: Message): void {
  setMessages((prev) => [...prev, message]);
}

function appendStatus(content: string): void {
  appendMessage({
    id: createId(),
    role: "status",
    content: sanitizeForTerminal(content),
  });
}

function appendError(content: string): void {
  appendMessage({
    id: createId(),
    role: "system",
    content: sanitizeForTerminal(content),
  });
}

function updateMessage(id: string, updater: (message: Message) => Message): void {
  setMessages((prev) => prev.map((message) => (message.id === id ? updater(message) : message)));
}

function handleMaskedInputChange(nextValue: string): void {
  const currentRaw = rawInputValue();
  const currentMask = "*".repeat(currentRaw.length);
  let nextRaw = currentRaw;

  if (nextValue.length < currentMask.length) {
    nextRaw = currentRaw.slice(0, nextValue.length);
  } else if (nextValue.length > currentMask.length) {
    const added = nextValue.slice(currentMask.length);
    nextRaw = currentRaw + added;
  }

  setRawInputValue(nextRaw);
  setInputValue("*".repeat(nextRaw.length));
}

function resetInput(): void {
  setInputValue("");
  setRawInputValue("");
  setHistoryIndex(-1);
}

function pushHistory(entry: string): void {
  setInputHistory((prev) => [...prev, entry]);
  setHistoryIndex(-1);
}

function handleHistoryUp(): void {
  if (isMaskedInput()) return;
  const history = inputHistory();
  if (history.length === 0) return;

  const nextIndex = historyIndex() < 0 ? history.length - 1 : Math.max(0, historyIndex() - 1);
  setHistoryIndex(nextIndex);
  const value = history[nextIndex] ?? "";
  setInputValue(value);
}

function handleHistoryDown(): void {
  if (isMaskedInput()) return;
  const history = inputHistory();
  if (history.length === 0) return;

  const nextIndex =
    historyIndex() < 0 ? history.length - 1 : Math.min(history.length - 1, historyIndex() + 1);
  setHistoryIndex(nextIndex);
  const value = history[nextIndex] ?? "";
  setInputValue(value);
}

function toggleMode(): void {
  setMode((prev) => (prev === "ask" ? "plan" : "ask"));
}

export function App() {
  const handleRpcEvent = (event: RpcEvent): void => {
    switch (event.type) {
      case "status":
        appendStatus(event.message);
        return;
      case "progress":
        appendStatus(`${event.stage}${event.percent ? ` (${String(event.percent)}%)` : ""}`);
        return;
      case "token":
        handleToken(event.content);
        return;
      case "interrupt":
        setIsProcessing(false);
        handleInterrupt(event.payload);
        return;
      case "complete":
        setIsProcessing(false);
        handleComplete(event.result);
        return;
      case "error":
        setIsProcessing(false);
        appendError(event.message);
        setActiveOperation(null);
        setStreamingMessageId(null);
        setCurrentQuestion(null);
        return;
      default:
        return;
    }
  };

  const rpc = new RpcClient(handleRpcEvent);

  const handleToken = (content: string): void => {
    const messageId = streamingMessageId();
    if (!messageId) {
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

    updateMessage(messageId, (message) => ({
      ...message,
      content: message.content + sanitizeForTerminal(content),
    }));
  };

  const handleInterrupt = (payload: InterruptPayload): void => {
    switch (payload.kind) {
      case "clarification": {
        const resumeType = activeOperation() === "productionalize" ? "productionalize" : "planning";
        const resumeId =
          resumeType === "productionalize"
            ? activeSession().productionSessionId
            : activeSession().planningTrackId;

        if (!resumeId) {
          appendError("Missing session ID for clarification response.");
          return;
        }

        setActiveDialog({
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
        const resumeId =
          resumeType === "productionalize"
            ? activeSession().productionSessionId
            : activeSession().planningTrackId;

        if (!resumeId) {
          appendError("Missing session ID for review response.");
          return;
        }

        setActiveDialog({
          kind: "review",
          docType: payload.docType,
          content: payload.content,
          instructions: payload.instructions,
          resume: { type: resumeType, id: resumeId },
        });
        return;
      }
      case "interview": {
        const resumeId = activeSession().productionSessionId;
        if (!resumeId) {
          appendError("Missing session ID for interview response.");
          return;
        }
        setActiveDialog({
          kind: "interview",
          questions: payload.questions,
          answers: {},
          index: 0,
          resume: { type: "productionalize", id: resumeId },
        });
        return;
      }
      default: {
        const _exhaustive: never = payload;
        appendError("Unsupported interrupt payload.");
      }
    }
  };

  const handleComplete = (result: unknown): void => {
    const pending = pendingCommand();
    if (pending) {
      handlePendingCommand(pending, result);
      setPendingCommand(null);
      return;
    }

    const operation = activeOperation();
    if (operation === "ask") {
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
      const messageId = streamingMessageId();
      if (messageId) {
        updateMessage(messageId, (message) => ({
          ...message,
          streaming: false,
          content: message.content ? message.content : sanitizeForTerminal(answer),
        }));
      }
      setStreamingMessageId(null);
      setCurrentQuestion(null);
      setActiveOperation(null);
      return;
    }

    if (operation === "planning") {
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
      setActiveSession((prev) => ({ ...prev, planningTrackId: undefined }));
      setActiveOperation(null);
      return;
    }

    if (operation === "productionalize") {
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
      setActiveSession((prev) => ({ ...prev, productionSessionId: undefined }));
      setActiveOperation(null);
      return;
    }
  };

  const handlePendingCommand = (
    command: NonNullable<ReturnType<typeof pendingCommand>>,
    result: unknown
  ): void => {
    switch (command) {
      case "model.list": {
        const parsed = ModelListSchema.safeParse(result);
        if (!parsed.success) {
          appendError("Failed to load model list.");
          return;
        }
        setActiveDialog({ kind: "model", models: parsed.data });
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
      default: {
        const _exhaustive: never = command;
        return;
      }
    }
  };

  const sendAsk = (question: string): void => {
    setActiveOperation("ask");
    setIsProcessing(true);
    setCurrentQuestion(question);
    const messageId = createId();
    setStreamingMessageId(messageId);

    appendMessage({
      id: createId(),
      role: "user",
      content: sanitizeForTerminal(question),
    });
    appendMessage({
      id: messageId,
      role: "assistant",
      content: "",
      streaming: true,
    });

    rpc.send({
      method: "ask.start",
      params: {
        question,
        history: askHistory(),
      },
    });
  };

  const sendPlanning = (idea: string): void => {
    const trackId = activeSession().planningTrackId ?? createId();
    setActiveSession((prev) => ({ ...prev, planningTrackId: trackId }));
    setActiveOperation("planning");
    setIsProcessing(true);

    appendMessage({
      id: createId(),
      role: "user",
      content: sanitizeForTerminal(idea),
    });

    rpc.send({
      method: "planning.start",
      params: {
        idea,
        trackId,
      },
    });
  };

  const sendProductionalize = (context?: string): void => {
    const sessionId = activeSession().productionSessionId ?? createId();
    setActiveSession((prev) => ({ ...prev, productionSessionId: sessionId }));
    setActiveOperation("productionalize");
    setIsProcessing(true);

    appendMessage({
      id: createId(),
      role: "user",
      content: sanitizeForTerminal(
        context ? `Production readiness: ${context}` : "Production readiness review"
      ),
    });

    rpc.send({
      method: "productionalize.start",
      params: {
        context,
        sessionId,
      },
    });
  };

  const showHelp = (): void => {
    const commandLines = slashCommands.map((cmd) => `${cmd.usage} - ${cmd.description}`).join("\n");
    appendMessage({
      id: createId(),
      role: "system",
      content: sanitizeForTerminal(
        `Commands:\n${commandLines}\n\nKeybinds:\nTab: switch Ask/Plan\nCtrl+C: cancel/exit\nCtrl+L: clear\nUp/Down: history`
      ),
    });
  };

  const openConnectDialog = (): void => {
    if (isProcessing()) return;
    setActiveDialog({
      kind: "connect",
      step: "openrouter",
      openrouterKey: "",
      tavilyKey: "",
    });
    resetInput();
  };

  const openModelDialog = (): void => {
    if (isProcessing()) return;
    setIsProcessing(true);
    setPendingCommand("model.list");
    rpc.send({ method: "model.list" });
  };

  const requestModelList = (): void => {
    if (isProcessing()) return;
    setIsProcessing(true);
    setPendingCommand("model.list");
    rpc.send({ method: "model.list" });
  };

  const requestModelCurrent = (): void => {
    setIsProcessing(true);
    setPendingCommand("model.current");
    rpc.send({ method: "model.current" });
  };

  const requestModelSet = (model: string): void => {
    if (!model) return;
    setIsProcessing(true);
    setPendingCommand("model.set");
    rpc.send({ method: "model.set", params: { model } });
  };

  const clearHistory = (): void => {
    setMessages([]);
    setAskHistory([]);
    setInputHistory([]);
    setHistoryIndex(-1);
    setStreamingMessageId(null);
    setCurrentQuestion(null);
  };

  const cancelOrExit = (): void => {
    if (isProcessing()) {
      if (activeOperation() === "ask") {
        rpc.send({ method: "ask.cancel" });
      } else {
        appendStatus("Canceling session and exiting.");
        rpc.close();
        process.exit(0);
      }
      return;
    }
    rpc.close();
    process.exit(0);
  };

  const startProductionReview = (context?: string): void => {
    if (isProcessing()) return;
    sendProductionalize(context);
  };

  const handleSlashCommand = (input: string): boolean => {
    const found = findSlashCommand(input);
    if (!found) {
      appendError(`Unknown command: ${input}`);
      return true;
    }

    found.command.run(
      {
        requestModelList,
        requestModelCurrent,
        requestModelSet,
        openModelDialog,
        openConnectDialog,
        clearHistory,
        exit: () => {
          rpc.close();
          process.exit(0);
        },
        startProductionReview,
        showHelp,
      },
      found.args
    );
    return true;
  };

  const handleDialogSubmit = (value: string): boolean => {
    const dialog = activeDialog();

    if (dialog.kind === "connect") {
      if (dialog.step === "openrouter") {
        if (!value.trim()) {
          appendError("OpenRouter API key is required.");
          return true;
        }
        setActiveDialog({
          ...dialog,
          step: "tavily",
          openrouterKey: value.trim(),
        });
        resetInput();
        return true;
      }

      setActiveDialog({ kind: "none" });
      setPendingCommand("connect");
      setIsProcessing(true);
      rpc.send({
        method: "connect",
        params: {
          openrouterKey: dialog.openrouterKey,
          tavilyKey: value.trim() || undefined,
        },
      });
      return true;
    }

    if (dialog.kind === "model") {
      const model = value.trim();
      if (model) {
        setActiveDialog({ kind: "none" });
        requestModelSet(model);
      }
      return true;
    }

    if (dialog.kind === "clarification") {
      const answers = { ...dialog.answers, [String(dialog.index)]: value };
      if (dialog.index + 1 >= dialog.questions.length) {
        setActiveDialog({ kind: "none" });
        setIsProcessing(true);
        if (dialog.resume.type === "planning") {
          rpc.send({
            method: "planning.resume",
            params: { trackId: dialog.resume.id, response: answers },
          });
        } else {
          rpc.send({
            method: "productionalize.resume",
            params: { sessionId: dialog.resume.id, response: answers },
          });
        }
      } else {
        setActiveDialog({ ...dialog, answers, index: dialog.index + 1 });
      }
      return true;
    }

    if (dialog.kind === "interview") {
      const question = dialog.questions.at(dialog.index);
      if (!question) {
        setActiveDialog({ kind: "none" });
        return true;
      }
      const trimmed = value.trim();
      const answer =
        question.type === "multiselect"
          ? trimmed
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : trimmed;
      const answers = { ...dialog.answers, [question.id]: answer };
      if (dialog.index + 1 >= dialog.questions.length) {
        setActiveDialog({ kind: "none" });
        setIsProcessing(true);
        rpc.send({
          method: "productionalize.resume",
          params: { sessionId: dialog.resume.id, response: answers },
        });
      } else {
        setActiveDialog({ ...dialog, answers, index: dialog.index + 1 });
      }
      return true;
    }

    if (dialog.kind === "review") {
      setActiveDialog({ kind: "none" });
      setIsProcessing(true);
      if (dialog.resume.type === "planning") {
        rpc.send({
          method: "planning.resume",
          params: { trackId: dialog.resume.id, response: value.trim() },
        });
      } else {
        rpc.send({
          method: "productionalize.resume",
          params: { sessionId: dialog.resume.id, response: value.trim() },
        });
      }
      return true;
    }

    return false;
  };

  const handleSubmit = (value: string): void => {
    const input = isMaskedInput() ? rawInputValue() : value;
    const trimmed = input.trim();
    if (!trimmed) {
      resetInput();
      return;
    }

    if (handleDialogSubmit(trimmed)) {
      resetInput();
      return;
    }

    if (trimmed.startsWith("/")) {
      handleSlashCommand(trimmed);
      pushHistory(trimmed);
      resetInput();
      return;
    }

    pushHistory(trimmed);
    resetInput();

    if (mode() === "ask") {
      sendAsk(trimmed);
      return;
    }

    sendPlanning(trimmed);
  };

  onMount(() => {
    void rpc.start();
    requestModelCurrent();
  });

  onCleanup(() => {
    rpc.close();
  });

  useAppKeybinds(
    {
      toggleMode,
      cancelOrExit,
      clearScreen: clearHistory,
      historyUp: handleHistoryUp,
      historyDown: handleHistoryDown,
    },
    () => isProcessing() || activeDialog().kind !== "none"
  );

  const dialog = activeDialog();
  const dialogNode =
    dialog.kind === "connect" ? (
      <Portal>
        <ConnectWizard step={dialog.step} />
      </Portal>
    ) : dialog.kind === "model" ? (
      <Portal>
        <ModelSelector models={dialog.models} />
      </Portal>
    ) : dialog.kind === "review" ? (
      <Portal>
        <ReviewDialog
          docType={dialog.docType}
          content={dialog.content}
          instructions={dialog.instructions}
        />
      </Portal>
    ) : dialog.kind === "clarification" ? (
      <Portal>
        <Questionnaire
          title="Clarifications"
          question={dialog.questions[dialog.index] ?? ""}
          progress={`Question ${String(dialog.index + 1)}/${String(dialog.questions.length)}`}
        />
      </Portal>
    ) : dialog.kind === "interview" ? (
      <Portal>
        <Questionnaire
          title="Production Interview"
          question={dialog.questions[dialog.index]?.question ?? ""}
          progress={`Question ${String(dialog.index + 1)}/${String(dialog.questions.length)}`}
          options={dialog.questions[dialog.index]?.options}
        />
      </Portal>
    ) : null;

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#0b0c10">
      <Header mode={mode()} model={currentModel()} />
      <Transcript messages={messages()} />
      <Prompt
        mode={mode()}
        value={inputValue()}
        placeholder={
          dialog.kind === "connect"
            ? dialog.step === "openrouter"
              ? "OpenRouter API key"
              : "Tavily API key (optional)"
            : dialog.kind === "model"
              ? "Model alias"
              : dialog.kind === "review"
                ? "approve / feedback"
                : dialog.kind === "clarification"
                  ? "Answer"
                  : dialog.kind === "interview"
                    ? "Answer"
                    : mode() === "ask"
                      ? "Ask about your codebase..."
                      : "Describe what you want to build..."
        }
        disabled={isProcessing()}
        onInput={(value) => {
          if (isMaskedInput()) {
            handleMaskedInputChange(value);
          } else {
            setInputValue(value);
            setRawInputValue("");
          }
        }}
        onSubmit={handleSubmit}
      />
      {dialogNode}
    </box>
  );
}
