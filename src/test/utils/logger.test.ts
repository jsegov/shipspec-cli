import { describe, it, expect, vi } from "vitest";
import {
  redact,
  redactObject,
  redactEnvValue,
  stripAnsi,
  sanitizeError,
  logger,
} from "../../utils/logger.js";

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

    it("should redact JWT-like tokens", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoyNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      expect(redact(`token: ${jwt}`)).toBe("token: [REDACTED]");
    });

    it("should redact Bearer tokens", () => {
      expect(redact("Authorization: Bearer my-secret-token")).toBe("[REDACTED]");
      expect(redact("Bearer abc.def.ghi")).toBe("[REDACTED]");
    });

    it("should redact Basic auth", () => {
      expect(redact("Authorization: Basic YWRtaW46cGFzc3dvcmQ=")).toBe("[REDACTED]");
    });

    it("should redact PEM blocks", () => {
      const pem =
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA75...\n-----END RSA PRIVATE KEY-----";
      expect(redact(`cert: ${pem}`)).toBe("cert: [REDACTED]");
    });

    it("should redact AWS Access Key IDs", () => {
      expect(redact("AWS_KEY=AKIA1234567890ABCDEF")).toBe("AWS_KEY=[REDACTED]");
    });

    it("should redact URL credentials", () => {
      const input = "Database URL: postgres://user:password123@localhost:5432/mydb";
      expect(redact(input)).toBe("Database URL: postgres://[REDACTED]@localhost:5432/mydb");
    });

    it("should not redact non-sensitive information", () => {
      const input = "Server started on port 3000";
      expect(redact(input)).toBe(input);
    });

    it("should redact Anthropic session keys", () => {
      const input = "Session key: sk-ant-sid01-abcdefghijklmnopqrstuvwxyz1234567890";
      expect(redact(input)).toContain("[REDACTED]");
      expect(redact(input)).not.toContain("sk-ant-sid01");
    });

    it("should redact high-entropy base64 strings", () => {
      const input =
        "Secret: dGhpc2lzYXZlcnlsb25nYmFzZTY0ZW5jb2RlZHN0cmluZ3RoYXRsb29rc2xpa2VhY2VydA==";
      expect(redact(input)).toContain("[REDACTED]");
    });

    it("should redact hex-encoded secrets", () => {
      const input = "Token: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
      expect(redact(input)).toContain("[REDACTED]");
    });

    it("should redact Authorization headers", () => {
      expect(redact("Authorization: Bearer my-token")).toContain("[REDACTED]");
      expect(redact("authorization: Basic dXNlcjpwYXNz")).toContain("[REDACTED]");
    });

    it("should not over-redact normal text", () => {
      const input = "This is a normal sentence with no secrets.";
      expect(redact(input)).toBe(input);
    });
  });

  describe("redactObject", () => {
    it("should redact strings in objects", () => {
      const input = {
        apiKey: "sk-1234567890abcdef12345678",
        message: "normal text",
      };
      const result = redactObject(input) as Record<string, string>;
      expect(result.apiKey).toBe("[REDACTED]");
      expect(result.message).toBe("normal text");
    });

    it("should recursively redact nested objects", () => {
      const input = {
        apiKey: "sk-1234567890abcdef12345678",
        nested: {
          token: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.test",
          normal: "text",
        },
      };
      const result = redactObject(input);
      const resultStr = JSON.stringify(result);
      expect(resultStr).toContain("[REDACTED]");
      expect(resultStr).not.toContain("sk-1234567890");
      expect(resultStr).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
      expect(resultStr).toContain("text");
    });

    it("should redact arrays", () => {
      const input = ["sk-1234567890abcdef12345678", "normal text"];
      const result = redactObject(input) as string[];
      expect(result[0]).toBe("[REDACTED]");
      expect(result[1]).toBe("normal text");
    });

    it("should handle mixed types", () => {
      const input = {
        count: 42,
        enabled: true,
        secret: "sk-1234567890abcdef12345678",
        items: ["Bearer token123456789", "normal"],
      };
      const result = redactObject(input);
      const resultStr = JSON.stringify(result);
      expect(resultStr).toContain("[REDACTED]");
      expect(resultStr).toContain("42");
      expect(resultStr).toContain("true");
      expect(resultStr).toContain("normal");
    });
  });

  describe("redactEnvValue", () => {
    it("should redact sensitive env vars", () => {
      expect(redactEnvValue("OPENAI_API_KEY", "secret")).toBe("[REDACTED]");
      expect(redactEnvValue("GITHUB_TOKEN", "secret")).toBe("[REDACTED]");
      expect(redactEnvValue("STRIPE_SECRET", "secret")).toBe("[REDACTED]");
      expect(redactEnvValue("DATABASE_URL", "postgres://...")).toBe("[REDACTED]");
      expect(redactEnvValue("PASSWORD", "mypass")).toBe("[REDACTED]");
      expect(redactEnvValue("MY_API_KEY", "abc")).toBe("[REDACTED]");
      expect(redactEnvValue("SECRET_TOKEN", "123")).toBe("[REDACTED]");
      expect(redactEnvValue("AUTH_CONFIG", "{}")).toBe("[REDACTED]");
    });

    it("should not redact non-sensitive env vars", () => {
      expect(redactEnvValue("NODE_ENV", "production")).toBe("production");
      expect(redactEnvValue("PORT", "3000")).toBe("3000");
    });
  });

  describe("stripAnsi", () => {
    it("should strip ANSI escape codes", () => {
      expect(stripAnsi("\x1b[31mRed Text\x1b[0m")).toBe("Red Text");
    });

    it("should strip non-printable characters except newline and tab", () => {
      expect(stripAnsi("Line 1\nLine 2\tTabbed\x07Alert")).toBe("Line 1\nLine 2\tTabbedAlert");
    });
  });

  describe("sanitizeError", () => {
    it("should redact secrets and strip ANSI from the error message", () => {
      const err = new Error("\x1b[31mFailed with sk-1234567890abcdef12345678\x1b[0m");
      expect(sanitizeError(err)).toBe("Failed with [REDACTED]");
    });

    it("should include redacted and stripped stack trace in verbose mode", () => {
      const err = new Error("Auth failed");
      err.stack =
        "Error: Auth failed\n  at Object.<anonymous> (\x1b[34msk-1234567890abcdef12345678\x1b[0m:1:1)";
      const sanitized = sanitizeError(err, true);
      expect(sanitized).toContain("Auth failed");
      expect(sanitized).toContain("[REDACTED]");
      expect(sanitized).not.toContain("\x1b[");
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
