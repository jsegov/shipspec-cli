import {
  createContext,
  useContext,
  createSignal,
  type ParentComponent,
  type Accessor,
} from "solid-js";

export interface Toast {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  duration: number;
  createdAt: number;
}

interface ToastContextValue {
  toasts: Accessor<Toast[]>;
  show: (message: string, type?: Toast["type"], duration?: number) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue>();

export const ToastProvider: ParentComponent = (props) => {
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const show = (message: string, type: Toast["type"] = "info", duration = 3000): string => {
    const id = `toast-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    const toast: Toast = { id, message, type, duration, createdAt: Date.now() };

    setToasts((prev) => [...prev, toast]);

    if (duration > 0) {
      setTimeout(() => {
        dismiss(id);
      }, duration);
    }

    return id;
  };

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const clear = () => setToasts([]);

  return (
    <ToastContext.Provider value={{ toasts, show, dismiss, clear }}>
      {props.children}
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
