import { describe, it, expect } from "vitest";
import { sanitizeForTerminal } from "./terminal-sanitize.js";
import { redactText } from "./redaction.js";

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

  it("should work correctly when composed with redactText", () => {
    const input = "API key: sk-test123456\x1b[2J\x1b[31mCleared screen!";
    const result = sanitizeForTerminal(redactText(input));

    // Should redact the API key
    expect(result).not.toContain("sk-test123456");
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
    // Incomplete sequences that don't match patterns should be left as-is or cleaned
    const input = "Text\x1b[incomplete";
    const result = sanitizeForTerminal(input);
    // Incomplete sequence won't match CSI pattern, but ESC itself should be handled
    expect(result).toBe("Text[incomplete");
  });
});
