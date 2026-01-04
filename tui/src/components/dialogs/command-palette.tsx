import { For, createMemo } from "solid-js";
import { useCommand } from "../../context/command-provider.js";

export function CommandPalette() {
  const command = useCommand();

  // For now, show all commands without filtering
  const filteredCommands = createMemo(() => command.search(""));

  return (
    <box
      position="absolute"
      top={2}
      left="25%"
      width="50%"
      height="auto"
      maxHeight="60%"
      flexDirection="column"
      borderStyle="single"
      borderColor="#45a29e"
      backgroundColor="#1f2833"
      padding={1}
    >
      <text fg="#66fcf1">Command Palette</text>
      <box height={1} />
      <text fg="#c5c6c7">Press Escape to close.</text>
      <box height={1} />
      <For each={filteredCommands().slice(0, 10)}>
        {(cmd) => (
          <box flexDirection="row" gap={1}>
            <text fg="#66fcf1">{cmd.name}</text>
            <text fg="#c5c6c7">- {cmd.description}</text>
            {cmd.shortcut && <text fg="#45a29e">[{cmd.shortcut}]</text>}
          </box>
        )}
      </For>
      {filteredCommands().length === 0 && <text fg="#c5c6c7">No commands found</text>}
    </box>
  );
}
