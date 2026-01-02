import { render } from "@opentui/solid";

import { App } from "./app.js";

void render(() => <App />).catch((err: unknown) => {
  process.stderr.write(`Failed to start TUI: ${String(err)}\n`);
  process.exit(1);
});
