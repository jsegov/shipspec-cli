/**
 * Terminal escape sequence sanitization utility.
 * Removes ANSI/OSC escape sequences from untrusted output to prevent terminal injection attacks.
 *
 * Security context:
 * - ANSI CSI sequences can manipulate terminal (clear screen, move cursor, change colors)
 * - OSC sequences can create hyperlinks (OSC 8), change terminal title, etc.
 * - Untrusted LLM output may contain malicious escape sequences
 *
 * References:
 * - CVE-2023-46321, CVE-2023-46322 (terminal escape injection)
 * - OWASP A03:2021 (Injection)
 */

/**
 * Sanitizes a string for terminal output by removing all ANSI/OSC escape sequences
 * and dangerous control characters.
 *
 * Preserves safe whitespace: newlines (\n), carriage returns (\r), tabs (\t)
 * Removes: All C0 control characters except safe whitespace, ANSI CSI/OSC sequences
 *
 * @param input - The untrusted string to sanitize
 * @returns Sanitized string safe for terminal output
 */
export function sanitizeForTerminal(input: string): string {
  let sanitized = input;

  // Remove ANSI CSI (Control Sequence Introducer) sequences
  // Format: ESC [ <params> <intermediate> <final>
  // Examples: \x1b[2J (clear screen), \x1b[31m (red color), \x1b[1;1H (cursor position)
  // Pattern: \x1B\[ followed by optional params [0-?]*, optional intermediates [ -/]*, final [@-~]
  // eslint-disable-next-line no-control-regex -- Control characters are intentionally matched for security sanitization
  sanitized = sanitized.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

  // Remove ANSI OSC (Operating System Command) sequences
  // Format: ESC ] <params> BEL or ESC ] <params> ST
  // Examples: \x1b]8;;https://evil.com\x07 (OSC 8 hyperlink), \x1b]0;Title\x07 (set title)
  // Terminators: \x07 (BEL) or \x1b\\ (ST = ESC \)
  // eslint-disable-next-line no-control-regex -- Control characters are intentionally matched for security sanitization
  sanitized = sanitized.replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, "");

  // Remove single ESC sequences (without [ or ])
  // Format: ESC <final>
  // Examples: \x1bM (reverse index), \x1b7 (save cursor)
  // Pattern: \x1B followed by single character from [@-Z\\-_]
  // eslint-disable-next-line no-control-regex -- Control characters are intentionally matched for security sanitization
  sanitized = sanitized.replace(/\x1B[@-Z\\-_]/g, "");

  // Remove all other C0 control characters except safe whitespace
  // Safe: \x09 (tab), \x0A (newline), \x0D (carriage return)
  // Unsafe: \x00-\x08, \x0B-\x0C, \x0E-\x1F, \x7F (DEL)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  return sanitized;
}
