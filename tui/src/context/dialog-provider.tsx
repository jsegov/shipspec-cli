import {
  createContext,
  useContext,
  createSignal,
  createMemo,
  type ParentComponent,
  type Accessor,
} from "solid-js";

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
