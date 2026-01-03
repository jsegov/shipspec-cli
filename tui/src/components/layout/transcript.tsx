import { For } from "solid-js";
import type { Message } from "../../context/session-provider.js";
import { MessageView } from "../chat/message.js";

interface TranscriptProps {
  messages: Message[];
}

export function Transcript(props: TranscriptProps) {
  return (
    <scrollbox flexGrow={1} padding={1} stickyScroll stickyStart="bottom" backgroundColor="#0b0c10">
      <box flexDirection="column" gap={1}>
        <For each={props.messages}>{(message) => <MessageView message={message} />}</For>
      </box>
    </scrollbox>
  );
}
