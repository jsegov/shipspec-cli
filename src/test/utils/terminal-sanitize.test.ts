import { describe, it, expect } from "vitest";
import { sanitizeForTerminal } from "../../utils/terminal-sanitize.js";
import { redactText } from "../../utils/redaction.js";

describe("sanitizeForTerminal", () => {
  it("should preserve normal text", () => {
    const input = "Hello, world! This is normal text.";
    expect(sanitizeForTerminal(input)).toBe(input);
  });

  it("should preserve newlines, tabs, and carriage returns", () => {
    const input = "Line 1\nLine 2\tTabbed\rCarriage return";
    expect(sanitizeForTerminal(input)).toBe(input);
  });

  it("should remove ANSI CSI clear screen sequence", () => {
    const input = "Before\x1b[2JAfter";
    expect(sanitizeForTerminal(input)).toBe("BeforeAfter");
  });

  it("should remove ANSI CSI color sequences", () => {
    const input = "Normal\x1b[31mRed text\x1b[0mNormal again";
    expect(sanitizeForTerminal(input)).toBe("NormalRed textNormal again");
  });

  it("should remove ANSI CSI cursor positioning", () => {
    const input = "Text\x1b[1;1HHome position";
    expect(sanitizeForTerminal(input)).toBe("TextHome position");
  });

  it("should remove OSC 8 hyperlink sequences (BEL terminator)", () => {
    const input = "Click \x1b]8;;https://evil.com\x07here\x1b]8;;\x07 to visit";
    expect(sanitizeForTerminal(input)).toBe("Click here to visit");
  });

  it("should remove OSC 8 hyperlink sequences (ST terminator)", () => {
    const input = "Link: \x1b]8;;file:///etc/passwd\x1b\\sensitive\x1b]8;;\x1b\\ text";
    expect(sanitizeForTerminal(input)).toBe("Link: sensitive text");
  });

  it("should remove OSC title sequences", () => {
    const input = "Window\x1b]0;Malicious Title\x07content";
    expect(sanitizeForTerminal(input)).toBe("Windowcontent");
  });

  it("should remove single ESC sequences", () => {
    const input = "Text\x1bMReverse index\x1b7Save cursor";
    expect(sanitizeForTerminal(input)).toBe("TextReverse indexSave cursor");
  });

  it("should remove C0 control characters except safe whitespace", () => {
    // \x00 (NUL), \x01 (SOH), \x08 (BS), \x0B (VT), \x0C (FF), \x1F (US), \x7F (DEL)
    const input = "Text\x00with\x01controls\x08here\x0B\x0C\x1F\x7Fend";
    expect(sanitizeForTerminal(input)).toBe("Textwithcontrolshereend");
  });

  it("should preserve intentional square brackets and escape-like text", () => {
    const input = "Use [options] or press ESC to exit";
    expect(sanitizeForTerminal(input)).toBe(input);
  });

  it("should handle empty strings", () => {
    expect(sanitizeForTerminal("")).toBe("");
  });

  it("should handle strings with only escape sequences", () => {
    const input = "\x1b[2J\x1b]8;;https://evil.com\x07\x1b[31m";
    expect(sanitizeForTerminal(input)).toBe("");
  });

  it("should handle very long inputs efficiently", () => {
    const longText = "Normal text ".repeat(10000);
    const input = `${longText}\x1b[2J${longText}`;
    const result = sanitizeForTerminal(input);
    expect(result).not.toContain("\x1b");
    expect(result.length).toBeLessThan(input.length);
  });

  describe("ReDoS Protection", () => {
    const TIMEOUT_MS = 100;
    const ITERATIONS = 3;

    /**
     * Measures execution time of sanitizeForTerminal over multiple iterations.
     * Returns the maximum elapsed time to catch worst-case scenarios.
     */
    function measureMaxTime(input: string, iterations: number): number {
      let maxElapsed = 0;
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        sanitizeForTerminal(input);
        const elapsed = performance.now() - start;
        maxElapsed = Math.max(maxElapsed, elapsed);
      }
      return maxElapsed;
    }

    it("should handle CSI adversarial input (alternating quantified classes) without hanging", () => {
      // Stress test for CSI pattern: /\x1B\[[0-?]*[ -/]*[@-~]/g
      // Craft input with alternating characters from [0-?] (0-9, :, ;, <, =, >, ?) and [ -/] (space to /)
      // to force backtracking when the regex tries different split points
      const csiCharsA = "0123456789:;<=>?";
      const csiCharsB = " !\"#$%&'()*+,-./";
      let malicious = "\x1b[";
      // Interleave characters from both classes to maximize backtracking attempts
      for (let i = 0; i < 1000; i++) {
        malicious += csiCharsA.charAt(i % csiCharsA.length);
        malicious += csiCharsB.charAt(i % csiCharsB.length);
      }
      // No terminating character from [@-~], forcing full backtrack
      malicious += "X".repeat(1000); // X is not in the terminator class

      const maxElapsed = measureMaxTime(malicious, ITERATIONS);
      expect(maxElapsed).toBeLessThan(TIMEOUT_MS);
    });

    it("should handle OSC adversarial input (long content without terminator) without hanging", () => {
      // Stress test for OSC pattern: /\x1B\][^\x07]*(\x07|\x1B\\)/g
      // Very long content without the BEL or ST terminator forces the regex
      // to consume everything and then fail, potentially causing backtracking
      const oscContent = "A".repeat(50000); // Long content without terminator
      const malicious = `\x1b]${oscContent}`;

      const maxElapsed = measureMaxTime(malicious, ITERATIONS);
      expect(maxElapsed).toBeLessThan(TIMEOUT_MS);
    });

    it("should handle OSC adversarial input (near-miss terminators) without hanging", () => {
      // Content with characters that almost match the terminator pattern
      // but don't quite (e.g., lots of \x06 which is close to \x07 BEL)
      const nearMissContent = "\x06".repeat(10000) + "text".repeat(5000);
      const malicious = `\x1b]${nearMissContent}`;

      const maxElapsed = measureMaxTime(malicious, ITERATIONS);
      expect(maxElapsed).toBeLessThan(TIMEOUT_MS);
    });

    it("should handle mixed adversarial sequences without hanging", () => {
      // Combine multiple partial/malformed sequences that don't terminate properly
      // This tests interactions between different regex replacements
      let malicious = "";
      for (let i = 0; i < 500; i++) {
        // Partial CSI without terminator
        malicious += "\x1b[" + "0".repeat(20) + " ".repeat(20);
        // Partial OSC without terminator
        malicious += "\x1b]" + "content".repeat(10);
        // Single ESC that won't match (invalid follow character)
        malicious += "\x1b" + "{"; // { is outside [@-Z\\-_]
      }

      const maxElapsed = measureMaxTime(malicious, ITERATIONS);
      expect(maxElapsed).toBeLessThan(TIMEOUT_MS);
    });

    it("should handle nested escape-like sequences without hanging", () => {
      // Input with many ESC bytes that could cause exponential pattern matching
      // when the engine tries to find valid sequences
      let malicious = "";
      // Many ESC bytes with partial sequence starts
      for (let i = 0; i < 5000; i++) {
        malicious += "\x1b[" + (i % 10).toString();
      }
      // No valid terminator for any of these

      const maxElapsed = measureMaxTime(malicious, ITERATIONS);
      expect(maxElapsed).toBeLessThan(TIMEOUT_MS);
    });

    it("should still correctly sanitize valid sequences after adversarial tests", () => {
      // Sanity check: ensure the function still works correctly
      const validInput = "Normal\x1b[31mRed\x1b[0mText";
      const result = sanitizeForTerminal(validInput);
      expect(result).toBe("NormalRedText");
    });
  });

  it("should work correctly when composed with redactText", () => {
    // API key must be at least 20 chars after 'sk-' to match redaction pattern
    const input = "API key: sk-test1234567890abcdefgh\x1b[2J\x1b[31mCleared screen!";
    const result = sanitizeForTerminal(redactText(input));

    // Should redact the API key
    expect(result).not.toContain("sk-test1234567890abcdefgh");
    expect(result).toContain("[REDACTED]");

    // Should remove escape sequences
    expect(result).not.toContain("\x1b");
    expect(result).toContain("Cleared screen!");
  });

  it("should handle mixed ANSI sequences and control characters", () => {
    const input = "Start\x1b[31m\x00red\x01text\x1b[0m\x08end";
    expect(sanitizeForTerminal(input)).toBe("Startredtextend");
  });

  it("should handle malformed ANSI sequences gracefully", () => {
    // Note: \x1b[i is actually a valid CSI sequence where 'i' is the final byte
    // (in range [@-~]), so it gets removed. True incomplete sequences without
    // a valid final byte would leave the partial sequence.
    const input = "Text\x1b[incomplete";
    const result = sanitizeForTerminal(input);
    // The CSI pattern matches \x1b[i (ESC [ followed by final byte 'i')
    expect(result).toBe("Textncomplete");
  });
});
