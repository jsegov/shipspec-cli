import {
  createContext,
  useContext,
  createSignal,
  onMount,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { useKV } from "./kv-provider.js";

export type ThemeMode = "light" | "dark";

export interface Theme {
  mode: ThemeMode;
  colors: {
    background: string;
    foreground: string;
    muted: string;
    primary: string;
    success: string;
    warning: string;
    error: string;
    border: string;
  };
}

const DARK_THEME: Theme = {
  mode: "dark",
  colors: {
    background: "#0b0c10",
    foreground: "#c5c6c7",
    muted: "#66fcf1",
    primary: "#45a29e",
    success: "#66fcf1",
    warning: "#f9a825",
    error: "#ef5350",
    border: "#1f2833",
  },
};

const LIGHT_THEME: Theme = {
  mode: "light",
  colors: {
    background: "#ffffff",
    foreground: "#1f2833",
    muted: "#66fcf1",
    primary: "#45a29e",
    success: "#4caf50",
    warning: "#ff9800",
    error: "#f44336",
    border: "#e0e0e0",
  },
};

interface ThemeContextValue {
  theme: Accessor<Theme>;
  mode: Accessor<ThemeMode>;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>();

export const ThemeProvider: ParentComponent = (props) => {
  const kv = useKV();
  const [mode, setModeSignal] = createSignal<ThemeMode>("dark");

  const theme = () => (mode() === "dark" ? DARK_THEME : LIGHT_THEME);

  onMount(() => {
    // Check saved preference
    const saved = kv.get("theme", null) as ThemeMode | null;
    if (saved === "light" || saved === "dark") {
      setModeSignal(saved);
    }
    // Default to dark (most terminal users prefer dark themes)
  });

  const setMode = (newMode: ThemeMode) => {
    setModeSignal(newMode);
    kv.set("theme", newMode);
  };

  const toggle = () => {
    setMode(mode() === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggle }}>
      {props.children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
