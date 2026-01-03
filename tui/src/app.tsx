import { useRenderer } from "@opentui/solid";
import { batch, createMemo, createSignal, onMount } from "solid-js";

import {
  ExitProvider,
  KVProvider,
  ToastProvider,
  ThemeProvider,
  RpcProvider,
  KeybindProvider,
  DialogProvider,
  CommandProvider,
  SessionProvider,
  useSession,
  useDialog,
  useKeybinds,
  useExit,
  useRpc,
  useToast,
} from "./context/index.js";
import { findSlashCommand, slashCommands, type SlashCommandContext } from "./commands/registry.js";
import { copyToClipboardAuto } from "./utils/osc.js";

import { Header } from "./components/layout/header.js";
import { Transcript } from "./components/layout/transcript.js";
import { Prompt } from "./components/layout/prompt.js";
import { ToastContainer } from "./components/layout/toast-container.js";
import { ConnectWizard } from "./components/dialogs/connect-wizard.js";
import { ModelSelector } from "./components/dialogs/model-selector.js";
import { CommandPalette } from "./components/dialogs/command-palette.js";

function AppContent() {
  const renderer = useRenderer();
  const session = useSession();
  const dialog = useDialog();
  const keybinds = useKeybinds();
  const exitCtx = useExit();
  const rpc = useRpc();
  const toast = useToast();

  const [inputValue, setInputValue] = createSignal("");
  const [rawInputValue, setRawInputValue] = createSignal("");
  const [historyIndex, setHistoryIndex] = createSignal(-1);

  const isMaskedInput = createMemo(() => dialog.dialog().kind === "connect");
  // Don't block for pending interactions - user needs to respond
  const isBlocked = createMemo(() => {
    if (session.hasActiveInteraction()) return false;
    return session.isProcessing() || dialog.isOpen();
  });

  // Register cleanup for renderer on exit (RPC cleanup is handled by RpcProvider)
  onMount(() => {
    exitCtx.registerCleanup(
      "renderer",
      () => {
        if (!renderer.isDestroyed) renderer.destroy();
      },
      20
    );
  });

  // Register keybinds
  onMount(() => {
    keybinds.register({
      id: "toggle-mode",
      keys: "tab",
      description: "Toggle ask/plan mode",
      action: () => {
        session.toggleMode();
      },
      when: () => !isBlocked(),
    });
    keybinds.register({
      id: "cancel-exit",
      keys: "ctrl+c",
      description: "Cancel or exit",
      action: () => {
        cancelOrExit();
      },
    });
    keybinds.register({
      id: "clear",
      keys: "ctrl+l",
      description: "Clear conversation",
      action: () => {
        session.clearMessages();
      },
      when: () => !session.isProcessing(),
    });
    keybinds.register({
      id: "new-session",
      keys: "ctrl+x n",
      description: "New session",
      action: () => {
        session.clearMessages();
      },
      category: "Session",
    });
    keybinds.register({
      id: "toggle-mode-leader",
      keys: "ctrl+x t",
      description: "Toggle mode",
      action: () => {
        session.toggleMode();
      },
      category: "Session",
      when: () => !isBlocked(),
    });
    keybinds.register({
      id: "quit",
      keys: "ctrl+x q",
      description: "Quit",
      action: () => void exitCtx.exit(0),
      category: "Session",
    });
    keybinds.register({
      id: "command-palette",
      keys: "ctrl+p",
      description: "Command palette",
      action: () => {
        dialog.open({ kind: "commandPalette" });
      },
      when: () => !isBlocked(),
    });
  });

  const cancelOrExit = () => {
    if (session.isProcessing()) {
      if (session.activeOperation() === "ask") {
        session.cancelAsk();
      } else {
        session.appendStatus("Canceling session and exiting.");
        void exitCtx.exit(0);
      }
      return;
    }
    void exitCtx.exit(0);
  };

  const resetInput = () => {
    batch(() => {
      setInputValue("");
      setRawInputValue("");
      setHistoryIndex(-1);
    });
  };

  const handleMaskedInputChange = (nextValue: string) => {
    const currentRaw = rawInputValue();
    const currentMask = "*".repeat(currentRaw.length);
    let nextRaw = currentRaw;

    if (nextValue.length < currentMask.length) {
      nextRaw = currentRaw.slice(0, nextValue.length);
    } else if (nextValue.length > currentMask.length) {
      nextRaw = currentRaw + nextValue.slice(currentMask.length);
    }

    batch(() => {
      setRawInputValue(nextRaw);
      setInputValue("*".repeat(nextRaw.length));
    });
  };

  const handleHistoryUp = () => {
    if (isMaskedInput()) return;
    const len = session.historyLength();
    if (len === 0) return;

    const nextIndex = historyIndex() < 0 ? len - 1 : Math.max(0, historyIndex() - 1);
    batch(() => {
      setHistoryIndex(nextIndex);
      setInputValue(session.getHistoryAt(nextIndex) ?? "");
    });
  };

  const handleHistoryDown = () => {
    if (isMaskedInput()) return;
    const len = session.historyLength();
    if (len === 0 || historyIndex() < 0) return;

    if (historyIndex() >= len - 1) {
      batch(() => {
        setHistoryIndex(-1);
        setInputValue("");
      });
      return;
    }

    const nextIndex = historyIndex() + 1;
    batch(() => {
      setHistoryIndex(nextIndex);
      setInputValue(session.getHistoryAt(nextIndex) ?? "");
    });
  };

  // Register arrow key keybinds
  onMount(() => {
    keybinds.register({
      id: "history-up",
      keys: "up",
      description: "Previous history",
      action: handleHistoryUp,
    });
    keybinds.register({
      id: "history-down",
      keys: "down",
      description: "Next history",
      action: handleHistoryDown,
    });
  });

  const buildSlashContext = (): SlashCommandContext => ({
    requestModelList: session.requestModelList,
    requestModelCurrent: session.requestModelCurrent,
    requestModelSet: session.requestModelSet,
    openModelDialog: () => {
      session.requestModelList();
    },
    openConnectDialog: () => {
      if (session.isProcessing()) return;
      dialog.open({ kind: "connect", step: "openrouter", openrouterKey: "", tavilyKey: "" });
      resetInput();
    },
    clearHistory: session.clearMessages,
    exit: () => void exitCtx.exit(0),
    startProductionReview: (ctx?: string) => {
      if (!session.isProcessing()) session.sendProductionalize(ctx);
    },
    showHelp: () => {
      const lines = slashCommands.map((c) => `${c.usage} - ${c.description}`).join("\n");
      const keybindInfo = keybinds
        .keybinds()
        .map((k) => `${k.keys}: ${k.description}`)
        .join("\n");
      session.appendMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: `Commands:\n${lines}\n\nKeybinds:\n${keybindInfo}`,
      });
    },
    listTracks: () => {
      rpc.send({ method: "planning.list" });
      toast.show("Loading tracks...", "info");
    },
    listOutputs: () => {
      rpc.send({ method: "productionalize.list" });
      toast.show("Loading outputs...", "info");
    },
    copyLastResponse: () => {
      const msgs = session.messages();
      const last = [...msgs].reverse().find((m) => m.role === "assistant");
      if (last) {
        copyToClipboardAuto(last.content);
        toast.show("Copied to clipboard", "success");
      } else {
        toast.show("No response to copy", "warning");
      }
    },
  });

  const handleDialogSubmit = (value: string): boolean => {
    const d = dialog.dialog();

    if (d.kind === "connect") {
      if (d.step === "openrouter") {
        if (!value.trim()) {
          session.appendError("OpenRouter API key is required.");
          return true;
        }
        dialog.update((prev) =>
          prev.kind === "connect" ? { ...prev, step: "tavily", openrouterKey: value.trim() } : prev
        );
        resetInput();
        return true;
      }
      dialog.close();
      session.sendConnect(d.openrouterKey, value.trim() || undefined);
      return true;
    }

    if (d.kind === "model") {
      const model = value.trim();
      if (model) {
        dialog.close();
        session.requestModelSet(model);
      }
      return true;
    }

    if (d.kind === "commandPalette") {
      dialog.close();
      return true;
    }

    return false;
  };

  const handleSubmit = (value: string) => {
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

    // Handle inline interaction responses (PRD feedback, clarifying questions, etc.)
    if (session.hasActiveInteraction()) {
      session.handleInteractionResponse(trimmed);
      session.pushHistory(trimmed);
      resetInput();
      return;
    }

    if (trimmed.startsWith("/")) {
      const found = findSlashCommand(trimmed);
      if (!found) {
        session.appendError(`Unknown command: ${trimmed}`);
      } else {
        found.command.run(buildSlashContext(), found.args);
      }
      session.pushHistory(trimmed);
      resetInput();
      return;
    }

    session.pushHistory(trimmed);
    resetInput();

    if (session.mode() === "ask") {
      session.sendAsk(trimmed);
    } else {
      session.sendPlanning(trimmed);
    }
  };

  // Make dialogNode reactive by using createMemo to re-evaluate when dialog state changes
  // Note: review, clarification, and interview are now handled inline in the transcript
  const dialogNode = createMemo(() => {
    const d = dialog.dialog();
    return d.kind === "connect" ? (
      <ConnectWizard step={d.step} />
    ) : d.kind === "model" ? (
      <ModelSelector models={d.models} />
    ) : d.kind === "commandPalette" ? (
      <CommandPalette />
    ) : null;
  });

  // Make placeholder reactive by using createMemo
  const placeholder = createMemo(() => {
    // Check for pending inline interaction first
    const interaction = session.pendingInteraction();
    if (interaction) {
      switch (interaction.kind) {
        case "document_review":
          return "approve / provide feedback";
        case "clarification":
        case "interview":
          return "Your answer";
      }
    }

    const d = dialog.dialog();
    return d.kind === "connect"
      ? d.step === "openrouter"
        ? "OpenRouter API key"
        : "Tavily API key (optional)"
      : d.kind === "model"
        ? "Model alias"
        : session.mode() === "ask"
          ? "Ask about your codebase..."
          : "Describe what you want to build...";
  });

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#0b0c10">
      <Header mode={session.mode()} model={session.currentModel()} />
      <Transcript messages={session.messages()} />
      <Prompt
        mode={session.mode()}
        value={inputValue()}
        placeholder={placeholder()}
        disabled={session.isProcessing()}
        onInput={(v) => {
          batch(() => {
            if (isMaskedInput()) {
              handleMaskedInputChange(v);
            } else {
              setInputValue(v);
              setRawInputValue("");
            }
          });
        }}
        onSubmit={handleSubmit}
      />
      {dialogNode()}
      <ToastContainer />
    </box>
  );
}

export function App() {
  return (
    <ExitProvider>
      <KVProvider>
        <ToastProvider>
          <ThemeProvider>
            <RpcProvider>
              <KeybindProvider>
                <DialogProvider>
                  <CommandProvider>
                    <SessionProvider>
                      <AppContent />
                    </SessionProvider>
                  </CommandProvider>
                </DialogProvider>
              </KeybindProvider>
            </RpcProvider>
          </ThemeProvider>
        </ToastProvider>
      </KVProvider>
    </ExitProvider>
  );
}
