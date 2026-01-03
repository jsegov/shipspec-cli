import {
  createContext,
  useContext,
  createSignal,
  createMemo,
  type ParentComponent,
  type Accessor,
} from "solid-js";

// Note: clarification, interview, and review dialogs have been moved to inline display
// in the transcript. See session-provider.tsx for the InlineInteraction implementation.
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
      kind: "commandPalette";
    };

interface DialogContextValue {
  dialog: Accessor<DialogState>;
  open: (state: DialogState) => void;
  close: () => void;
  isOpen: Accessor<boolean>;
  update: (updater: (current: DialogState) => DialogState) => void;
}

const DialogContext = createContext<DialogContextValue>();

export const DialogProvider: ParentComponent = (props) => {
  const [dialog, setDialog] = createSignal<DialogState>({ kind: "none" });

  const isOpen = createMemo(() => dialog().kind !== "none");

  const open = (state: DialogState) => setDialog(state);
  const close = () => setDialog({ kind: "none" });
  const update = (updater: (current: DialogState) => DialogState) => {
    setDialog(updater);
  };

  return (
    <DialogContext.Provider value={{ dialog, open, close, isOpen, update }}>
      {props.children}
    </DialogContext.Provider>
  );
};

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog must be used within DialogProvider");
  }
  return ctx;
}
