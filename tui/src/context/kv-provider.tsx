import { createContext, useContext, createSignal, onMount, type ParentComponent } from "solid-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { useExit } from "./exit-provider.js";

interface KVContextValue {
  get: (key: string, defaultValue: unknown) => unknown;
  set: (key: string, value: unknown) => void;
  remove: (key: string) => void;
  flush: () => void;
}

const KVContext = createContext<KVContextValue>();

export const KVProvider: ParentComponent = (props) => {
  const exit = useExit();
  const projectRoot = process.env.SHIPSPEC_PROJECT_ROOT ?? process.cwd();
  const kvPath = join(projectRoot, ".ship-spec", "tui.json");

  const [store, setStore] = createSignal<Record<string, unknown>>({});
  const [dirty, setDirty] = createSignal(false);

  const flush = () => {
    if (!dirty()) return;
    try {
      const dir = dirname(kvPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      writeFileSync(kvPath, JSON.stringify(store(), null, 2), { mode: 0o600 });
      setDirty(false);
    } catch {
      // Silent fail on flush
    }
  };

  onMount(() => {
    // Load existing data
    if (existsSync(kvPath)) {
      try {
        const data: unknown = JSON.parse(readFileSync(kvPath, "utf-8"));
        if (typeof data === "object" && data !== null) {
          setStore(data as Record<string, unknown>);
        }
      } catch {
        // Ignore parse errors, start fresh
      }
    }

    // Register save-on-exit cleanup (priority 10 = early)
    exit.registerCleanup("kv-flush", flush, 10);
  });

  const get = (key: string, defaultValue: unknown): unknown => {
    const value = store()[key];
    return value !== undefined ? value : defaultValue;
  };

  const set = (key: string, value: unknown) => {
    setStore((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const remove = (key: string) => {
    setStore((prev) => {
      const entries = Object.entries(prev).filter(([k]) => k !== key);
      return Object.fromEntries(entries);
    });
    setDirty(true);
  };

  return (
    <KVContext.Provider value={{ get, set, remove, flush }}>{props.children}</KVContext.Provider>
  );
};

export function useKV(): KVContextValue {
  const ctx = useContext(KVContext);
  if (!ctx) {
    throw new Error("useKV must be used within KVProvider");
  }
  return ctx;
}
