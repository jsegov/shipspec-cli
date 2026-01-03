import type { Message } from "../../context/session-provider.js";

interface MessageProps {
  message: Message;
}

const roleColors: Record<Message["role"], string> = {
  user: "#a5b4fc",
  assistant: "#e2e8f0",
  status: "#38bdf8",
  system: "#94a3b8",
};

const roleLabels: Record<Message["role"], string> = {
  user: "You",
  assistant: "Ship Spec",
  status: "Status",
  system: "System",
};

export function MessageView(props: MessageProps) {
  const color = roleColors[props.message.role];
  const label = roleLabels[props.message.role];

  return (
    <box flexDirection="column" gap={0}>
      <text fg={color}>{label}</text>
      <text fg="#e2e8f0" wrapMode="word">
        {props.message.content}
      </text>
    </box>
  );
}
