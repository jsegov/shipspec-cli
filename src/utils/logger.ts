import chalk from "chalk";

/**
 * Logger utility for CLI output.
 * Uses stderr for all log messages to keep stdout clean for piping.
 */

import { redactText, redactObject, SENSITIVE_NAMES, safeTruncate } from "./redaction.js";
import { sanitizeForTerminal } from "./terminal-sanitize.js";
export { redactText, redactObject, SENSITIVE_NAMES, safeTruncate };
export type { Redacted } from "./redaction.js";

/**
 * Redacts sensitive environment variable values if the name matches certain patterns.
 * Also applies pattern-based redaction to the value itself.
 */
export function redactEnvValue(name: string, value: string): string {
  if (SENSITIVE_NAMES.some((pattern) => pattern.test(name))) {
    return "[REDACTED]";
  }
  return redactText(value);
}

/**
 * Sanitizes an error for logging, redacting secrets and removing dangerous terminal escape sequences.
 * Uses sanitizeForTerminal which handles a broader set of sequences than basic ANSI stripping,
 * including OSC hyperlinks (clickjacking prevention), window title changes, and CSI sequences.
 * Recursively sanitizes the 'cause' property if present.
 */
export function sanitizeError(err: unknown, verbose = false): string {
  if (err instanceof Error) {
    const message = sanitizeForTerminal(redactText(err.message));
    let result = message;

    if (verbose && err.stack) {
      result += `\n${sanitizeForTerminal(redactText(err.stack))}`;
    }

    if (err.cause) {
      result += `\n[Cause]: ${sanitizeError(err.cause, verbose)}`;
    }

    return result;
  }
  return sanitizeForTerminal(redactText(String(err)));
}

/**
 * Logger utility for CLI output.
 * Uses stderr for all log messages to keep stdout clean for piping.
 */
export const logger = {
  info: (msg: string) => {
    console.error(chalk.blue(`[INFO] ${redactText(msg)}`));
  },
  warn: (msg: string) => {
    console.error(chalk.yellow(`[WARN] ${redactText(msg)}`));
  },
  error: (msg: string | Error, verbose?: boolean) => {
    const isVerbose = verbose ?? process.argv.includes("--verbose");
    if (msg instanceof Error) {
      console.error(chalk.red(`[ERROR] ${sanitizeError(msg, isVerbose)}`));
    } else {
      console.error(chalk.red(`[ERROR] ${redactText(msg)}`));
    }
  },
  debug: (msg: string, verbose?: boolean) => {
    const isVerbose = verbose ?? process.argv.includes("--verbose");
    if (isVerbose) console.error(chalk.gray(`[DEBUG] ${redactText(msg)}`));
  },
  success: (msg: string) => {
    console.error(chalk.green(`[SUCCESS] ${redactText(msg)}`));
  },
  progress: (msg: string) => {
    console.error(chalk.cyan(redactText(msg)));
  },
  plain: (msg: string) => {
    console.error(redactText(msg));
  },
  output: (msg: string) => {
    console.log(redactText(msg));
  },
};
