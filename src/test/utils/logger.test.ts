import { describe, it, expect, vi } from "vitest";
import { redact, redactEnvValue, sanitizeError, logger } from "../../utils/logger.js";

describe("Logger Utility", () => {
  describe("redact", () => {
    it("should redact OpenAI API keys", () => {
      const input = "Connecting with key sk-1234567890abcdef12345678";
      expect(redact(input)).toBe("Connecting with key [REDACTED]");
    });

    it("should redact Anthropic API keys", () => {
      const input =
        "Using sk-ant-sid01-abcdef1234567890abcd-abcdef1234567890abcdef1234567890abcdef12";
      expect(redact(input)).toBe("Using [REDACTED]");
    });

    it("should redact URL credentials", () => {
      const input = "Database URL: postgres://user:password123@localhost:5432/mydb";
      expect(redact(input)).toBe("Database URL: postgres://[REDACTED]@localhost:5432/mydb");
    });

    it("should not redact non-sensitive information", () => {
      const input = "Server started on port 3000";
      expect(redact(input)).toBe(input);
    });
  });

  describe("redactEnvValue", () => {
    it("should redact sensitive env vars", () => {
      expect(redactEnvValue("OPENAI_API_KEY", "secret")).toBe("[REDACTED]");
      expect(redactEnvValue("GITHUB_TOKEN", "secret")).toBe("[REDACTED]");
      expect(redactEnvValue("STRIPE_SECRET", "secret")).toBe("[REDACTED]");
      expect(redactEnvValue("DATABASE_URL", "postgres://...")).toBe("[REDACTED]");
    });

    it("should not redact non-sensitive env vars", () => {
      expect(redactEnvValue("NODE_ENV", "production")).toBe("production");
      expect(redactEnvValue("PORT", "3000")).toBe("3000");
    });
  });

  describe("sanitizeError", () => {
    it("should redact secrets from the error message", () => {
      const err = new Error("Failed with key sk-1234567890abcdef12345678");
      expect(sanitizeError(err)).toBe("Failed with key [REDACTED]");
    });

    it("should include redacted stack trace in verbose mode", () => {
      const err = new Error("Auth failed");
      err.stack = "Error: Auth failed\n  at Object.<anonymous> (sk-1234567890abcdef12345678:1:1)";
      const sanitized = sanitizeError(err, true);
      expect(sanitized).toContain("Auth failed");
      expect(sanitized).toContain("[REDACTED]");
    });

    it("should only include message in non-verbose mode", () => {
      const err = new Error("Auth failed");
      err.stack = "Error: Auth failed\n  at Object.<anonymous> (file.ts:1:1)";
      expect(sanitizeError(err, false)).toBe("Auth failed");
    });
  });

  describe("logger", () => {
    it("should redact output for all methods", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
        /* noop */
      });
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
        /* noop */
      });

      logger.info("Key: sk-1234567890abcdef12345678");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[REDACTED]"));

      logger.error("Failed with sk-1234567890abcdef12345678");
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[REDACTED]"));

      logger.output("Secret: sk-1234567890abcdef12345678");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("[REDACTED]"));

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });
});
