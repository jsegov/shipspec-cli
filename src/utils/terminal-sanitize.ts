/**
 * Sanitizes a string for terminal output by removing ANSI/OSC escape sequences
 * and dangerous control characters to prevent terminal injection attacks.
 */
export function sanitizeForTerminal(input: string): string {
  let sanitized = input;

  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/\x1B\][^\x07\x1b]{0,10000}(\x07|\x1B\\)/g, "");

  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/\x1B[0-9@-Z\\-_]/g, "");

  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  return sanitized;
}
