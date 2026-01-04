import { describe, it, expect } from "vitest";

import { validateSessionId } from "../../flows/productionalize-flow.js";
import { CliUsageError } from "../../cli/errors.js";

describe("productionalize flow session validation", () => {
  it("should accept valid session IDs", () => {
    expect(() => {
      validateSessionId("session-abc_123");
    }).not.toThrow();
  });

  it("should reject invalid session IDs", () => {
    expect(() => {
      validateSessionId("bad session id");
    }).toThrow(CliUsageError);
  });

  it("should handle ReDoS-style inputs without hanging", () => {
    const malicious = "a".repeat(10000);
    const start = Date.now();
    expect(() => {
      validateSessionId(malicious);
    }).toThrow(CliUsageError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
