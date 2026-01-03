import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { RpcEventSchema, type RpcEvent, type RpcRequest } from "./protocol.js";

type RpcEventHandler = (event: RpcEvent) => void;

/**
 * Resolves the backend server path relative to this module's location.
 * The TUI and backend are both part of the CLI package:
 * - TUI bundle is at tui/dist/index.js (flat bundle from Bun build)
 * - TUI source is at tui/src/rpc/client.ts (during development)
 * - Backend is at dist/backend/server.js (or src/backend/server.ts in dev)
 */
function resolveBackendPath(): { path: string; useDist: boolean } | null {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Detect if running from bundled flat output or source tree.
  // Bundle: tui/dist/index.js -> 2 levels up to CLI root
  // Source: tui/src/rpc/client.ts -> 3 levels up to CLI root
  const isBundled = __filename.endsWith("dist/index.js") || __dirname.endsWith("dist");
  const cliRoot = isBundled ? resolve(__dirname, "../..") : resolve(__dirname, "../../..");

  const distPath = join(cliRoot, "dist/backend/server.js");
  const srcPath = join(cliRoot, "src/backend/server.ts");

  if (existsSync(distPath)) {
    return { path: distPath, useDist: true };
  }
  if (existsSync(srcPath)) {
    return { path: srcPath, useDist: false };
  }
  return null;
}

export class RpcClient {
  private process: ReturnType<typeof Bun.spawn> | null = null;
  private buffer = "";
  private readonly onEvent: RpcEventHandler;

  constructor(onEvent: RpcEventHandler) {
    this.onEvent = onEvent;
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const resolved = resolveBackendPath();
    if (!resolved) {
      this.onEvent({
        type: "error",
        code: "backend_missing",
        message: "Backend entry not found. CLI package may be corrupted.",
      });
      return;
    }

    const { path: backendPath, useDist } = resolved;

    const projectRoot = process.env.SHIPSPEC_PROJECT_ROOT ?? process.cwd();
    const nodeArgs = useDist ? [backendPath] : ["--loader", "tsx", backendPath];

    this.process = Bun.spawn({
      cmd: ["node", ...nodeArgs],
      cwd: projectRoot,
      env: {
        ...process.env,
        SHIPSPEC_PROJECT_ROOT: projectRoot,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });

    const stdout = this.process.stdout;
    if (!stdout || typeof stdout === "number") {
      this.onEvent({
        type: "error",
        code: "backend_start_failed",
        message: "Backend process missing readable stdout.",
      });
      return;
    }

    const reader = stdout.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      this.buffer += decoder.decode(value, { stream: true });

      let newlineIndex = this.buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        newlineIndex = this.buffer.indexOf("\n");

        if (!line) {
          continue;
        }

        try {
          const jsonParsed: unknown = JSON.parse(line);
          const parsed = RpcEventSchema.safeParse(jsonParsed);
          if (parsed.success) {
            this.onEvent(parsed.data);
          } else {
            this.onEvent({
              type: "error",
              code: "invalid_event",
              message: parsed.error.issues.map((issue) => issue.message).join(", "),
            });
          }
        } catch {
          this.onEvent({
            type: "error",
            code: "invalid_event",
            message: "Failed to parse backend event.",
          });
        }
      }
    }
  }

  send(request: RpcRequest): void {
    const stdin = this.process?.stdin;
    if (!stdin || typeof stdin === "number") {
      this.onEvent({
        type: "error",
        code: "backend_not_running",
        message: "Backend process is not running.",
      });
      return;
    }

    const payload = `${JSON.stringify(request)}\n`;
    const encoder = new TextEncoder();
    stdin.write(encoder.encode(payload));
  }

  close(): void {
    this.process?.kill();
    this.process = null;
  }
}
