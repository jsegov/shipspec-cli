import chalk from "chalk";

/**
 * Logger utility for CLI output.
 * Uses stderr for all log messages to keep stdout clean for piping.
 */
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI-style keys
  /sk-ant-sid01-[a-zA-Z0-9]{20,}-[a-zA-Z0-9]{40,}/g, // Anthropic-style keys
];
const URL_CRED_PATTERN = /\/\/[^/]+:[^/]+@/g;

/**
 * Redacts sensitive information from a string.
 */
export function redact(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  redacted = redacted.replace(URL_CRED_PATTERN, "//[REDACTED]@");
  return redacted;
}

/**
 * Redacts sensitive environment variable values if the name matches certain patterns.
 */
export function redactEnvValue(name: string, value: string): string {
  const sensitiveNames = [/API_KEY$/i, /TOKEN$/i, /SECRET$/i, /DATABASE_URL$/i];
  if (sensitiveNames.some((pattern) => pattern.test(name))) {
    return "[REDACTED]";
  }
  return value;
}

/**
 * Sanitizes an error for logging, redacting secrets and optionally including the stack trace.
 */
export function sanitizeError(err: unknown, verbose = false): string {
  if (err instanceof Error) {
    const message = redact(err.message);
    if (verbose && err.stack) {
      return `${message}\n${redact(err.stack)}`;
    }
    return message;
  }
  return redact(String(err));
}

/**
 * Logger utility for CLI output.
 * Uses stderr for all log messages to keep stdout clean for piping.
 */
export const logger = {
  info: (msg: string) => {
    console.error(chalk.blue(`[INFO] ${redact(msg)}`));
  },
  warn: (msg: string) => {
    console.error(chalk.yellow(`[WARN] ${redact(msg)}`));
  },
  error: (msg: string | Error, verbose = process.argv.includes("--verbose")) => {
    if (msg instanceof Error) {
      console.error(chalk.red(`[ERROR] ${sanitizeError(msg, verbose)}`));
    } else {
      console.error(chalk.red(`[ERROR] ${redact(msg)}`));
    }
  },
  debug: (msg: string, verbose = process.argv.includes("--verbose")) => {
    if (verbose) console.error(chalk.gray(`[DEBUG] ${redact(msg)}`));
  },
  success: (msg: string) => {
    console.error(chalk.green(`[SUCCESS] ${redact(msg)}`));
  },
  progress: (msg: string) => {
    console.error(chalk.cyan(redact(msg)));
  },
  plain: (msg: string) => {
    console.error(redact(msg));
  },
  output: (msg: string) => {
    console.log(redact(msg));
  },
};
