import { describe, it, expect } from "vitest";
import { redact } from "../../utils/logger.js";

/**
 * ReDoS Protection Tests
 *
 * These tests verify that the regex patterns in logger.ts do not exhibit
 * catastrophic backtracking behavior that could lead to denial of service.
 *
 * Tests use timing assertions to ensure patterns complete in <100ms even
 * with maliciously crafted input designed to trigger exponential backtracking.
 */

describe("ReDoS Protection", () => {
  describe("PEM Block Pattern", () => {
    it("should handle repeated PEM BEGIN markers without hanging", () => {
      // Malicious input: Many "-----BEGIN -----" without matching END
      const malicious = "-----BEGIN -----".repeat(1000);
      const start = Date.now();

      redact(malicious);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100); // Must complete in <100ms
    });

    it("should handle nested BEGIN/END pairs without hanging", () => {
      // Malicious input: Nested BEGIN without proper structure
      const malicious = "-----BEGIN RSA PRIVATE KEY -----BEGIN ".repeat(500);
      const start = Date.now();

      redact(malicious);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it("should still redact valid PEM blocks", () => {
      const validPEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAwhatever12345abcdefgh
ijklmnopqrstuvwxyzABCDEFGHIJKLMNOP
-----END RSA PRIVATE KEY-----`;

      expect(redact(validPEM)).toBe("[REDACTED]");
    });

    it("should redact PEM blocks with multi-word types", () => {
      const validPEM = `-----BEGIN ENCRYPTED PRIVATE KEY-----
MIIEpAIBAAKCAQEAwhatever
-----END ENCRYPTED PRIVATE KEY-----`;

      expect(redact(validPEM)).toBe("[REDACTED]");
    });
  });

  describe("URL Credentials Pattern", () => {
    it("should handle repeated colon-dot patterns without hanging", () => {
      // Malicious input: Many ".:.:." patterns without @
      const malicious = "//.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.:.".repeat(500);
      const start = Date.now();

      redact(malicious);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it("should handle many colons without @ symbol", () => {
      // Malicious input: Multiple colons that could cause backtracking
      const malicious = "//user:pass:extra:more:stuff:".repeat(500);
      const start = Date.now();

      redact(malicious);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it("should still redact URL credentials", () => {
      const url = "https://user:password@example.com/path";
      const result = redact(url);

      expect(result).toContain("//[REDACTED]@");
      expect(result).not.toContain("user");
      expect(result).not.toContain("password");
    });

    it("should redact complex URL credentials", () => {
      const url = "postgresql://admin:Sup3rS3cr3t!@db.example.com:5432/mydb";
      const result = redact(url);

      expect(result).toContain("//[REDACTED]@");
      expect(result).not.toContain("admin");
      expect(result).not.toContain("Sup3rS3cr3t!");
    });
  });

  describe("Input Length Validation", () => {
    it("should truncate extremely long inputs", () => {
      // Create a string longer than MAX_REDACTION_LENGTH (50000)
      const veryLong = "a".repeat(100000);
      const result = redact(veryLong);

      expect(result).toContain("[... truncated for security]");
      expect(result.length).toBeLessThan(100000);
    });

    it("should not truncate inputs within limit", () => {
      const normal = "a".repeat(1000);
      const result = redact(normal);

      expect(result).not.toContain("[... truncated for security]");
      expect(result).toBe(normal);
    });

    it("should truncate at exactly 50KB boundary", () => {
      const exactly50KB = "a".repeat(50001);
      const result = redact(exactly50KB);

      expect(result).toContain("[... truncated for security]");
    });
  });

  describe("Other Pattern Safety", () => {
    it("should handle long JWT-like strings without hanging", () => {
      // Very long base64-like strings
      const malicious =
        "eyJ" + "A".repeat(10000) + "." + "B".repeat(10000) + "." + "C".repeat(10000);
      const start = Date.now();

      redact(malicious);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it("should still redact valid JWTs", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const result = redact(jwt);

      expect(result).toBe("[REDACTED]");
    });

    it("should handle very long base64 strings", () => {
      const longBase64 = "A".repeat(5000) + "=";
      const start = Date.now();

      redact(longBase64);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    it("should redact API keys with bounded length", () => {
      const apiKey = "sk-" + "a".repeat(50);
      const result = redact(apiKey);

      expect(result).toBe("[REDACTED]");
    });

    it("should redact Authorization headers", () => {
      const auth = "Authorization: Bearer " + "t".repeat(200);
      const result = redact(auth);

      expect(result).toBe("[REDACTED]");
      expect(result).not.toContain("Bearer");
    });

    it("should redact Authorization headers with short tokens that don't match Bearer pattern", () => {
      const auth = "Authorization: Bearer token123";
      const result = redact(auth);

      expect(result).toBe("[REDACTED]");
    });

    it("should redact Authorization headers with custom schemes", () => {
      const auth = "Authorization: CustomScheme some-long-token-value";
      const result = redact(auth);

      expect(result).toBe("[REDACTED]");
    });

    it("should redact Proxy-Authorization headers", () => {
      const auth = "Proxy-Authorization: Basic dXNlcjpwYXNz";
      const result = redact(auth);

      expect(result).toBe("[REDACTED]");
    });
  });

  describe("Combined Pattern Testing", () => {
    it("should handle multiple secret types in one string efficiently", () => {
      const combined = `
        API Key: sk-${"a".repeat(50)}
        PEM: -----BEGIN PRIVATE KEY-----${"X".repeat(100)}-----END PRIVATE KEY-----
        URL: https://user:pass@example.com
        JWT: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
      `;

      const start = Date.now();
      const result = redact(combined);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(result).toContain("[REDACTED]");
      expect(result).not.toContain("sk-");
      expect(result).not.toContain("user:pass");
    });

    it("should handle edge case: empty string", () => {
      expect(redact("")).toBe("");
    });

    it("should handle edge case: only whitespace", () => {
      const whitespace = "   \n\t  \r\n  ";
      expect(redact(whitespace)).toBe(whitespace);
    });

    it("should handle edge case: no secrets present", () => {
      const normal = "This is just a normal log message with no secrets";
      expect(redact(normal)).toBe(normal);
    });
  });
});
