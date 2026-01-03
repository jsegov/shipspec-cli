import {
  createContext,
  useContext,
  createSignal,
  onCleanup,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { useKeyboard } from "@opentui/solid";

export interface Keybind {
  id: string;
  keys: string; // e.g., "ctrl+c", "ctrl+x n" (leader sequence)
  description: string;
  action: () => void;
  category?: string;
  when?: () => boolean;
}

interface KeybindContextValue {
  register: (keybind: Keybind) => void;
  unregister: (id: string) => void;
  keybinds: Accessor<Keybind[]>;
  isLeaderActive: Accessor<boolean>;
  leaderKey: Accessor<string>;
  suspend: () => void;
  resume: () => void;
  isSuspended: Accessor<boolean>;
}

const KeybindContext = createContext<KeybindContextValue>();

const LEADER_KEY = "ctrl+x";
const LEADER_TIMEOUT = 2000;

interface KeyEvent {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  preventDefault: () => void;
}

function parseKeyCombo(key: KeyEvent): string {
  const parts: string[] = [];
  if (key.ctrl) parts.push("ctrl");
  if (key.meta) parts.push("meta");
  if (key.shift) parts.push("shift");
  parts.push(key.name);
  return parts.join("+");
}

export const KeybindProvider: ParentComponent = (props) => {
  const [keybinds, setKeybinds] = createSignal<Keybind[]>([]);
  const [leaderActive, setLeaderActive] = createSignal(false);
  const [suspended, setSuspended] = createSignal(false);
  let leaderTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearLeader = () => {
    if (leaderTimeout) {
      clearTimeout(leaderTimeout);
      leaderTimeout = null;
    }
    setLeaderActive(false);
  };

  const activateLeader = () => {
    clearLeader();
    setLeaderActive(true);
    leaderTimeout = setTimeout(clearLeader, LEADER_TIMEOUT);
  };

  useKeyboard((key: KeyEvent) => {
    if (suspended()) return;

    const combo = parseKeyCombo(key);

    // Check for leader key
    if (combo === LEADER_KEY) {
      key.preventDefault();
      activateLeader();
      return;
    }

    // If leader is active, look for leader sequences
    if (leaderActive()) {
      const leaderCombo = `${LEADER_KEY} ${combo}`;
      const matched = keybinds().find((kb) => kb.keys === leaderCombo && (kb.when?.() ?? true));

      if (matched) {
        key.preventDefault();
        clearLeader();
        matched.action();
        return;
      }

      // Invalid sequence, clear leader
      clearLeader();
    }

    // Check direct keybinds (not leader sequences)
    const matched = keybinds().find(
      (kb) => kb.keys === combo && !kb.keys.includes(" ") && (kb.when?.() ?? true)
    );

    if (matched) {
      key.preventDefault();
      matched.action();
    }
  });

  onCleanup(clearLeader);

  const register = (keybind: Keybind) => {
    setKeybinds((prev) => [...prev.filter((kb) => kb.id !== keybind.id), keybind]);
  };

  const unregister = (id: string) => {
    setKeybinds((prev) => prev.filter((kb) => kb.id !== id));
  };

  const suspend = () => {
    setSuspended(true);
    clearLeader();
  };

  const resume = () => setSuspended(false);

  return (
    <KeybindContext.Provider
      value={{
        register,
        unregister,
        keybinds,
        isLeaderActive: leaderActive,
        leaderKey: () => LEADER_KEY,
        suspend,
        resume,
        isSuspended: suspended,
      }}
    >
      {props.children}
    </KeybindContext.Provider>
  );
};

export function useKeybinds(): KeybindContextValue {
  const ctx = useContext(KeybindContext);
  if (!ctx) {
    throw new Error("useKeybinds must be used within KeybindProvider");
  }
  return ctx;
}
