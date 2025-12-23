import chalk from "chalk";

/**
 * Logger utility for CLI output.
 * Uses stderr for all log messages to keep stdout clean for piping.
 */

import { redactText, redactObject, SENSITIVE_NAMES, safeTruncate } from "./redaction.js";
export { redactText, redactObject, SENSITIVE_NAMES, safeTruncate };
export type { Redacted } from "./redaction.js";

/**
 * Strips ANSI escape codes and other non-printable control characters.
 * Keeps newlines and tabs.
 */
export function stripAnsi(text: string): string {
  return (
    text
      /* eslint-disable no-control-regex */
      .replace(/\x1b\[[0-9;]*m/g, "") // ANSI escape codes
      .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
    /* eslint-enable no-control-regex */
  );
}

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
 * Sanitizes an error for logging, redacting secrets and optionally including the stack trace.
 * Recursively redacts the 'cause' property if present.
 */
export function sanitizeError(err: unknown, verbose = false): string {
  if (err instanceof Error) {
    const message = stripAnsi(redactText(err.message));
    let result = message;

    if (verbose && err.stack) {
      result += `\n${stripAnsi(redactText(err.stack))}`;
    }

    if (err.cause) {
      result += `\n[Cause]: ${sanitizeError(err.cause, verbose)}`;
    }

    return result;
  }
  return stripAnsi(redactText(String(err)));
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
