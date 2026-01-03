import { For } from "solid-js";
import { useToast, type Toast } from "../../context/toast-provider.js";

const typeColors: Record<Toast["type"], string> = {
  info: "#66fcf1",
  success: "#4caf50",
  warning: "#f9a825",
  error: "#ef5350",
};

export function ToastContainer() {
  const toast = useToast();

  return (
    <box position="absolute" top={1} right={1} width={40} flexDirection="column" gap={1}>
      <For each={toast.toasts()}>
        {(t) => (
          <box
            borderStyle="single"
            borderColor={typeColors[t.type]}
            backgroundColor="#1f2833"
            padding={1}
          >
            <text fg={typeColors[t.type]} wrapMode="word">
              {t.message}
            </text>
          </box>
        )}
      </For>
    </box>
  );
}
