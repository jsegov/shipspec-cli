import { createInterface } from "readline";

import { redactObject } from "../utils/logger.js";
import { logger } from "../utils/logger.js";
import { RpcRequestSchema, type RpcEvent } from "./protocol.js";
import { createRpcHandlers } from "./handlers/index.js";

const handlers = createRpcHandlers();

function writeEvent(event: RpcEvent): void {
  const redacted = redactObject(event);
  process.stdout.write(`${JSON.stringify(redacted)}\n`);
}

async function handleLine(line: string): Promise<void> {
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

  try {
    for await (const event of handlers.handleRequest(parsed.data)) {
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

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    await handleLine(line);
  }
}

void main();
