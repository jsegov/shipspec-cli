import { useKeyboard } from "@opentui/solid";
import type { Accessor } from "solid-js";

export interface KeybindHandlers {
  toggleMode: () => void;
  cancelOrExit: () => void;
  clearScreen: () => void;
  historyUp: () => void;
  historyDown: () => void;
}

export function useAppKeybinds(handlers: KeybindHandlers, blockToggle: Accessor<boolean>): void {
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      handlers.cancelOrExit();
      return;
    }

    if (key.ctrl && key.name === "l") {
      key.preventDefault();
      handlers.clearScreen();
      return;
    }

    if (key.name === "tab" && !blockToggle()) {
      key.preventDefault();
      handlers.toggleMode();
      return;
    }

    if (key.name === "up") {
      key.preventDefault();
      handlers.historyUp();
      return;
    }

    if (key.name === "down") {
      key.preventDefault();
      handlers.historyDown();
      return;
    }
  });
}
