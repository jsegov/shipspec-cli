import { describe, it, expect } from "vitest";

import { RpcEventSchema, RpcRequestSchema } from "../../backend/protocol.js";

describe("RPC protocol", () => {
  it("accepts valid ask.start requests", () => {
    const parsed = RpcRequestSchema.safeParse({
      method: "ask.start",
      params: { question: "What does this do?" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown request methods", () => {
    const parsed = RpcRequestSchema.safeParse({
      method: "unknown.method",
      params: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts status events", () => {
    const parsed = RpcEventSchema.safeParse({
      type: "status",
      message: "Working...",
    });
    expect(parsed.success).toBe(true);
  });
});
