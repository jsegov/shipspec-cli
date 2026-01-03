import {
  createContext,
  useContext,
  createSignal,
  onMount,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { useKeybinds } from "./keybind-provider.js";
import { useDialog } from "./dialog-provider.js";
import { fuzzyFilter } from "../utils/fuzzy.js";

export interface Command {
  id: string;
  name: string;
  description: string;
  category: string;
  shortcut?: string; // Slash command alias, e.g., "/model"
  keybind?: string; // Keyboard shortcut, e.g., "ctrl+p"
  execute: () => void;
}

interface CommandContextValue {
  commands: Accessor<Command[]>;
  register: (command: Command) => void;
  unregister: (id: string) => void;
  execute: (id: string) => boolean;
  search: (query: string) => Command[];
  openPalette: () => void;
  closePalette: () => void;
  isPaletteOpen: Accessor<boolean>;
}

const CommandContext = createContext<CommandContextValue>();

export const CommandProvider: ParentComponent = (props) => {
  const keybinds = useKeybinds();
  const dialog = useDialog();
  const [commands, setCommands] = createSignal<Command[]>([]);

  const isPaletteOpen = () => dialog.dialog().kind === "commandPalette";

  const register = (command: Command) => {
    setCommands((prev) => [...prev.filter((c) => c.id !== command.id), command]);
  };

  const unregister = (id: string) => {
    setCommands((prev) => prev.filter((c) => c.id !== id));
  };

  const execute = (id: string): boolean => {
    const cmd = commands().find((c) => c.id === id);
    if (cmd) {
      closePalette();
      cmd.execute();
      return true;
    }
    return false;
  };

  const search = (query: string): Command[] => {
    return fuzzyFilter(commands(), query, (cmd) => cmd.name);
  };

  const openPalette = () => {
    dialog.open({ kind: "commandPalette" });
    keybinds.suspend();
  };

  const closePalette = () => {
    if (isPaletteOpen()) {
      dialog.close();
      keybinds.resume();
    }
  };

  // Register palette keybind
  onMount(() => {
    keybinds.register({
      id: "command-palette",
      keys: "ctrl+p",
      description: "Open command palette",
      category: "general",
      action: openPalette,
    });
  });

  return (
    <CommandContext.Provider
      value={{
        commands,
        register,
        unregister,
        execute,
        search,
        openPalette,
        closePalette,
        isPaletteOpen,
      }}
    >
      {props.children}
    </CommandContext.Provider>
  );
};

export function useCommand(): CommandContextValue {
  const ctx = useContext(CommandContext);
  if (!ctx) {
    throw new Error("useCommand must be used within CommandProvider");
  }
  return ctx;
}
