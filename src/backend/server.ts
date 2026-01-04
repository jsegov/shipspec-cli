import { createInterface } from "readline";

import { redactObject } from "../utils/logger.js";
import { logger } from "../utils/logger.js";
import { RpcRequestSchema, type RpcEvent, type RpcRequest } from "./protocol.js";
import { createRpcHandlers } from "./handlers/index.js";

const handlers = createRpcHandlers();

function writeEvent(event: RpcEvent): void {
  const redacted = redactObject(event);
  process.stdout.write(`${JSON.stringify(redacted)}\n`);
}

/**
 * Control methods that should be processed immediately without blocking.
 * These methods are synchronous or very fast and need to execute even while
 * a streaming request (like ask.start) is in progress.
 */
const CONTROL_METHODS: RpcRequest["method"][] = ["ask.cancel"];

function isControlMethod(method: string): boolean {
  return (CONTROL_METHODS as string[]).includes(method);
}

async function handleRequest(request: RpcRequest): Promise<void> {
  try {
    for await (const event of handlers.handleRequest(request)) {
      writeEvent(event);
    }
  } catch (err) {
    writeEvent({
      type: "error",
      code: "handler_error",
      message: "Unhandled backend error.",
    });
    logger.error(err instanceof Error ? err : new Error(String(err)));
  }
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch (err) {
    writeEvent({
      type: "error",
      code: "invalid_json",
      message: "Failed to parse JSON request.",
    });
    logger.warn(`Invalid JSON received: ${String(err)}`);
    return;
  }

  const parsed = RpcRequestSchema.safeParse(payload);
  if (!parsed.success) {
    writeEvent({
      type: "error",
      code: "invalid_request",
      message: parsed.error.issues.map((issue) => issue.message).join(", "),
    });
    return;
  }

  // Control methods (like ask.cancel) are processed synchronously to allow
  // cancellation while a streaming request is in progress. Non-control
  // methods run concurrently without blocking subsequent requests.
  if (isControlMethod(parsed.data.method)) {
    // Process control methods synchronously (they use sync generators)
    void handleRequest(parsed.data);
  } else {
    // Fire and forget for streaming/async requests - allows concurrent processing
    void handleRequest(parsed.data);
  }
}

function main(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", (line: string) => {
    handleLine(line);
  });
}

main();
