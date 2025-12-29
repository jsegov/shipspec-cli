/**
 * Sanitizes a string for terminal output by removing ANSI/OSC escape sequences
 * and dangerous control characters to prevent terminal injection attacks.
 */
export function sanitizeForTerminal(input: string): string {
  let sanitized = input;

  sanitized = sanitized.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

  sanitized = sanitized.replace(/\x1B\][^\x07\x1b]{0,10000}(\x07|\x1B\\)/g, "");

  sanitized = sanitized.replace(/\x1B[0-9@-Z\\-_]/g, "");

  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  return sanitized;
}
