import {
  createContext,
  useContext,
  createSignal,
  onCleanup,
  type ParentComponent,
  type Accessor,
} from "solid-js";

interface ExitCallback {
  id: string;
  priority: number;
  callback: () => void | Promise<void>;
}

interface ExitContextValue {
  registerCleanup: (id: string, callback: () => void | Promise<void>, priority?: number) => void;
  unregisterCleanup: (id: string) => void;
  exit: (code?: number) => Promise<never>;
  isExiting: Accessor<boolean>;
}

const ExitContext = createContext<ExitContextValue>();

export const ExitProvider: ParentComponent = (props) => {
  const [callbacks, setCallbacks] = createSignal<ExitCallback[]>([]);
  const [isExiting, setIsExiting] = createSignal(false);

  const registerCleanup = (id: string, callback: () => void | Promise<void>, priority = 100) => {
    setCallbacks((prev) => [...prev.filter((c) => c.id !== id), { id, priority, callback }]);
  };

  const unregisterCleanup = (id: string) => {
    setCallbacks((prev) => prev.filter((c) => c.id !== id));
  };

  const exit = async (code = 0): Promise<never> => {
    if (isExiting()) {
      // Prevent double exit - return pending promise that never resolves
      return new Promise(() => {
        /* intentionally empty */
      });
    }

    setIsExiting(true);

    const sorted = [...callbacks()].sort((a, b) => a.priority - b.priority);
    for (const { callback } of sorted) {
      try {
        await callback();
      } catch {
        // Continue cleanup even on error
      }
    }

    process.exit(code);
  };

  onCleanup(() => {
    // Clear callbacks on unmount
    setCallbacks([]);
  });

  return (
    <ExitContext.Provider value={{ registerCleanup, unregisterCleanup, exit, isExiting }}>
      {props.children}
    </ExitContext.Provider>
  );
};

export function useExit(): ExitContextValue {
  const ctx = useContext(ExitContext);
  if (!ctx) {
    throw new Error("useExit must be used within ExitProvider");
  }
  return ctx;
}
