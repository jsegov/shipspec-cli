import { describe, it, expect } from "vitest";

import { validateTrackId } from "../../flows/planning-flow.js";
import { CliUsageError } from "../../cli/errors.js";

describe("planning flow track validation", () => {
  it("should accept valid track IDs", () => {
    expect(() => {
      validateTrackId("track-123_ok");
    }).not.toThrow();
  });

  it("should reject invalid track IDs", () => {
    expect(() => {
      validateTrackId("track with spaces");
    }).toThrow(CliUsageError);
  });

  it("should handle ReDoS-style inputs without hanging", () => {
    const malicious = "a".repeat(10000);
    const start = Date.now();
    expect(() => {
      validateTrackId(malicious);
    }).toThrow(CliUsageError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
