import { existsSync } from "fs";
import { join } from "path";

import { RpcEventSchema, type RpcEvent, type RpcRequest } from "./protocol.js";

type RpcEventHandler = (event: RpcEvent) => void;

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

    const projectRoot = process.env.SHIPSPEC_PROJECT_ROOT ?? process.cwd();
    const distPath = join(projectRoot, "dist/backend/server.js");
    const srcPath = join(projectRoot, "src/backend/server.ts");
    const useDist = existsSync(distPath);
    const backendPath = useDist ? distPath : srcPath;

    if (!existsSync(backendPath)) {
      this.onEvent({
        type: "error",
        code: "backend_missing",
        message: `Backend entry not found at ${backendPath}.`,
      });
      return;
    }

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
      stderr: "inherit",
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
          const parsed = RpcEventSchema.safeParse(JSON.parse(line));
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
