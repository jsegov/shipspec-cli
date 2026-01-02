import type { Message } from "../../state/app-state.js";
import { MessageView } from "../chat/message.js";

interface TranscriptProps {
  messages: Message[];
}

export function Transcript(props: TranscriptProps) {
  return (
    <scrollbox flexGrow={1} padding={1} stickyScroll stickyStart="bottom" backgroundColor="#0b0c10">
      <box flexDirection="column" gap={1}>
        {props.messages.map((message) => (
          <MessageView message={message} />
        ))}
      </box>
    </scrollbox>
  );
}
