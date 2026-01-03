import type { Mode } from "../../context/session-provider.js";

interface HeaderProps {
  mode: Mode;
  model: string;
}

export function Header(props: HeaderProps) {
  return (
    <box
      height={3}
      padding={1}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      backgroundColor="#101218"
      border
      borderColor="#1f2937"
    >
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg="#22d3ee">Ship Spec</text>
        <text fg="#fbbf24">[{props.mode === "ask" ? "ASK" : "PLAN"}]</text>
      </box>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg="#94a3b8">Model:</text>
        <text fg="#e2e8f0">{props.model}</text>
        <text fg="#64748b">Tab | /help</text>
      </box>
    </box>
  );
}
