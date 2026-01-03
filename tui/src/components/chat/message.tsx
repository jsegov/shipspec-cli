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

  // Check for special message types
  const isDocument = props.message.meta?.isDocument;
  const isQuestion = props.message.meta?.isQuestion;
  const docType = props.message.meta?.docType;

  // Build label with optional badge
  let displayLabel = label;
  if (isDocument && docType) {
    displayLabel = `${label} [${docType.toUpperCase()}]`;
  }

  // Determine content color based on message type
  let contentColor = "#e2e8f0"; // default
  if (isDocument) {
    contentColor = "#c4b5fd"; // purple for documents
  } else if (isQuestion) {
    contentColor = "#86efac"; // green for questions
  }

  return (
    <box flexDirection="column" gap={0}>
      <text fg={color}>{displayLabel}</text>
      <text fg={contentColor} wrapMode="word">
        {props.message.content}
      </text>
    </box>
  );
}
