import { For, createMemo } from "solid-js";
import { fuzzyFilter } from "../../utils/fuzzy.js";
import { slashCommands, type SlashCommand } from "../../commands/registry.js";

interface SlashAutocompleteProps {
  query: string;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export const MAX_VISIBLE_COMMANDS = 8;

export function SlashAutocomplete(props: SlashAutocompleteProps) {
  const filteredCommands = createMemo(() => {
    const q = props.query;
    if (!q) return slashCommands;
    // Match against both name and aliases
    return fuzzyFilter(slashCommands, q, (cmd) => {
      return [cmd.name, ...(cmd.aliases ?? [])].join(" ");
    });
  });

  const visibleCommands = createMemo(() => filteredCommands().slice(0, MAX_VISIBLE_COMMANDS));

  return (
    <box
      position="absolute"
      bottom={4}
      left={0}
      width="60%"
      height="auto"
      maxHeight="50%"
      flexDirection="column"
      borderStyle="single"
      borderColor="#45a29e"
      backgroundColor="#1f2833"
      padding={1}
    >
      <text fg="#66fcf1">Slash Commands</text>
      <box height={1} />
      <For each={visibleCommands()}>
        {(cmd, index) => {
          const isSelected = () => index() === props.selectedIndex;
          return (
            <box
              flexDirection="row"
              gap={1}
              backgroundColor={isSelected() ? "#45a29e" : undefined}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={isSelected() ? "#0b0c10" : "#66fcf1"}>/{cmd.name}</text>
              {cmd.aliases && cmd.aliases.length > 0 && (
                <text fg={isSelected() ? "#1f2833" : "#6b7280"}>
                  ({cmd.aliases.map((a) => `/${a}`).join(", ")})
                </text>
              )}
              <text fg={isSelected() ? "#0b0c10" : "#c5c6c7"}>{cmd.description}</text>
            </box>
          );
        }}
      </For>
      {filteredCommands().length === 0 && <text fg="#c5c6c7">No commands found</text>}
      {filteredCommands().length > MAX_VISIBLE_COMMANDS && (
        <text fg="#6b7280">... and {filteredCommands().length - MAX_VISIBLE_COMMANDS} more</text>
      )}
    </box>
  );
}
