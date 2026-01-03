import type { Mode } from "../../context/session-provider.js";

interface PromptProps {
  mode: Mode;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onInput: (value: string) => void;
  onSubmit: (value: string) => void;
}

export function Prompt(props: PromptProps) {
  return (
    <box
      height={3}
      padding={1}
      flexDirection="row"
      alignItems="center"
      backgroundColor="#101218"
      border
      borderColor="#1f2937"
      gap={2}
    >
      <text fg="#fbbf24">{props.mode === "ask" ? "ask>" : "plan>"}</text>
      <input
        flexGrow={1}
        value={props.value}
        placeholder={props.placeholder}
        onInput={props.onInput}
        onSubmit={props.onSubmit}
        focused={!props.disabled}
        backgroundColor="#111827"
        focusedBackgroundColor="#111827"
        textColor="#e2e8f0"
        focusedTextColor="#e2e8f0"
        placeholderColor="#6b7280"
      />
    </box>
  );
}
