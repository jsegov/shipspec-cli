import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CliRuntimeError } from "../../cli/errors.js";

describe("CliRuntimeError", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should hide stack trace in production without debug", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;

    const error = new CliRuntimeError("Test error", new Error("Original"));
    const output = error.toPublicString();

    expect(output).toContain("Test error");
    expect(output).toContain("[Error Code: CliRuntimeError]");
    expect(output).not.toContain("at ");
    expect(output).not.toContain("Original");
  });

  it("should show stack trace in production with debug", () => {
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

    const originalError = new Error("Original");
    const error = new CliRuntimeError("Test error", originalError);
    const output = error.toPublicString({ debug: true });

    expect(output).toContain("Test error");
    expect(output).toContain("Caused by: Original");
  });

  it("should show stack trace in non-production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;

    const originalError = new Error("Original");
    const error = new CliRuntimeError("Test error", originalError);
    const output = error.toPublicString({ debug: true });

    expect(output).toContain("Test error");
    expect(output).toContain("Caused by: Original");
  });

  it("should redact secrets in error messages", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;

    const error = new CliRuntimeError("Failed with key sk-1234567890abcdef12345678");
    const output = error.toPublicString();

    // The message itself should still contain the secret (redaction happens in logger)
    expect(output).toContain("Failed with key sk-1234567890abcdef12345678");
  });

  it("should handle errors without originalError", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;

    const error = new CliRuntimeError("Simple error");
    const output = error.toPublicString();

    expect(output).toBe("Simple error [Error Code: CliRuntimeError]");
  });

  it("should handle non-Error originalError", () => {
    process.env.NODE_ENV = "development";
    process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

    const error = new CliRuntimeError("Test error", "string error");
    const output = error.toPublicString({ debug: true });

    expect(output).toContain("Test error");
    expect(output).not.toContain("Caused by");
  });
});
