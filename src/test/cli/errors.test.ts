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

  describe("production mode", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    it("should hide stack trace without debug", () => {
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK;

      const error = new CliRuntimeError("Test error", new Error("Original"));
      const output = error.toPublicString();

      expect(output).toContain("Test error");
      expect(output).toContain("[Error Code: CliRuntimeError]");
      expect(output).not.toContain("at ");
      expect(output).not.toContain("Original");
    });

    it("should NOT show stack trace with debug env var alone (requires ack)", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK;

      const originalError = new Error("Original cause");
      const error = new CliRuntimeError("Test error", originalError);
      const output = error.toPublicString();

      // Should be minimal output - debug is gated in production
      expect(output).toContain("Test error");
      expect(output).toContain("[Error Code: CliRuntimeError]");
      expect(output).not.toContain("Caused by:");
      expect(output).not.toContain("at ");
    });

    it("should NOT show stack trace with debug option alone (requires ack)", () => {
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK;

      const originalError = new Error("Original cause");
      const error = new CliRuntimeError("Test error", originalError);
      const output = error.toPublicString({ debug: true });

      // Even explicit debug=true requires ack in production
      expect(output).toContain("Test error");
      expect(output).toContain("[Error Code: CliRuntimeError]");
      expect(output).not.toContain("Caused by:");
    });

    it("should show sanitized stack trace with debug AND ack", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK = "I_UNDERSTAND_SECURITY_RISK";

      const originalError = new Error("Original cause");
      const error = new CliRuntimeError("Test error", originalError);
      const output = error.toPublicString();

      expect(output).toContain("Test error");
      expect(output).toContain("Caused by: Original cause");
      // Stack trace should be present
      expect(output).toContain("at ");
    });

    it("should redact secrets in all output fields", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK = "I_UNDERSTAND_SECURITY_RISK";

      // Create an error with secrets in message
      const secretKey = "sk-1234567890abcdef1234567890abcdef";
      const error = new CliRuntimeError(
        `Failed with key ${secretKey}`,
        new Error(`Original error with key: ${secretKey}`)
      );
      const output = error.toPublicString();

      // Secrets should be redacted in both message and caused-by
      expect(output).toContain("Failed with key [REDACTED]");
      expect(output).toContain("Caused by: Original error with key: [REDACTED]");
      expect(output).not.toContain(secretKey);
    });

    it("should redact secrets even in minimal production output", () => {
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK;

      const secretKey = "sk-1234567890abcdef1234567890abcdef";
      const error = new CliRuntimeError(`API call failed: ${secretKey}`);
      const output = error.toPublicString();

      expect(output).toContain("API call failed: [REDACTED]");
      expect(output).not.toContain(secretKey);
    });
  });

  describe("non-production mode", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    it("should show stack trace with debug option", () => {
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;

      const originalError = new Error("Original");
      const error = new CliRuntimeError("Test error", originalError);
      const output = error.toPublicString({ debug: true });

      expect(output).toContain("Test error");
      expect(output).toContain("Caused by: Original");
    });

    it("should show stack trace with debug env var (no ack required)", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

      const originalError = new Error("Original");
      const error = new CliRuntimeError("Test error", originalError);
      const output = error.toPublicString();

      expect(output).toContain("Test error");
      expect(output).toContain("Caused by: Original");
      expect(output).toContain("at ");
    });

    it("should redact secrets in debug output", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

      const jwtToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const error = new CliRuntimeError(`Auth failed: ${jwtToken}`, new Error("Nested JWT error"));
      const output = error.toPublicString();

      expect(output).toContain("Auth failed: [REDACTED]");
      expect(output).not.toContain(jwtToken);
    });

    it("should strip ANSI codes from output", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

      // Create error with ANSI codes in message
      const error = new CliRuntimeError(
        "\x1b[31mRed error\x1b[0m",
        new Error("\x1b[33mYellow cause\x1b[0m")
      );
      const output = error.toPublicString();

      expect(output).toContain("Red error");
      expect(output).toContain("Yellow cause");
      expect(output).not.toContain("\x1b[");
    });

    it("should strip OSC hyperlink sequences (clickjacking prevention)", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

      // OSC 8 hyperlink sequence - could be used for clickjacking attacks
      const error = new CliRuntimeError(
        "Click \x1b]8;;https://evil.com\x07here\x1b]8;;\x07 to continue",
        new Error("Nested \x1b]8;;file:///etc/passwd\x1b\\link\x1b]8;;\x1b\\ error")
      );
      const output = error.toPublicString();

      // Text should remain but hyperlink sequences should be stripped
      expect(output).toContain("Click here to continue");
      expect(output).toContain("Nested link error");
      expect(output).not.toContain("evil.com");
      expect(output).not.toContain("passwd");
      expect(output).not.toContain("\x1b]");
      expect(output).not.toContain("\x07");
    });

    it("should strip OSC window title sequences", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

      // OSC 0/1/2 - window/icon title manipulation
      const error = new CliRuntimeError(
        "Error\x1b]0;Malicious Title\x07 occurred",
        new Error("Cause\x1b]2;Evil Window Name\x07 here")
      );
      const output = error.toPublicString();

      expect(output).toContain("Error occurred");
      expect(output).toContain("Cause here");
      expect(output).not.toContain("Malicious Title");
      expect(output).not.toContain("Evil Window Name");
      expect(output).not.toContain("\x1b]");
    });

    it("should strip CSI cursor and screen manipulation sequences", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

      // CSI sequences for cursor positioning and screen clearing
      const error = new CliRuntimeError(
        "Before\x1b[2JAfter", // Clear screen
        new Error("At\x1b[1;1HHome") // Move cursor to home position
      );
      const output = error.toPublicString();

      expect(output).toContain("BeforeAfter");
      expect(output).toContain("AtHome");
      expect(output).not.toContain("\x1b[2J");
      expect(output).not.toContain("\x1b[1;1H");
    });

    it("should strip C1 control sequences", () => {
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

      // Single ESC sequences (C1 control codes)
      const error = new CliRuntimeError(
        "Text\x1bMReverse\x1b7Save", // Reverse index and save cursor
        new Error("More\x1b8Restore") // Restore cursor
      );
      const output = error.toPublicString();

      expect(output).toContain("TextReverseSave");
      expect(output).toContain("MoreRestore");
    });
  });

  describe("edge cases", () => {
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

    it("should handle URL credentials in error messages", () => {
      process.env.NODE_ENV = "development";
      process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

      const error = new CliRuntimeError(
        "Connection failed: postgres://admin:secretpass@db.example.com/mydb"
      );
      const output = error.toPublicString();

      expect(output).toContain("Connection failed: postgres://[REDACTED]@db.example.com/mydb");
      expect(output).not.toContain("admin:secretpass");
    });

    it("should handle AWS keys in error messages", () => {
      process.env.NODE_ENV = "production";
      delete process.env.SHIPSPEC_DEBUG_DIAGNOSTICS;

      const error = new CliRuntimeError("AWS error: AKIAIOSFODNN7EXAMPLE");
      const output = error.toPublicString();

      expect(output).toContain("AWS error: [REDACTED]");
      expect(output).not.toContain("AKIAIOSFODNN7EXAMPLE");
    });
  });
});
