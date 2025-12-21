import chalk from "chalk";

/**
 * Logger utility for CLI output.
 * Uses stderr for all log messages to keep stdout clean for piping.
 */
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI-style keys
  /sk-ant-[a-zA-Z0-9_-]{10,}/g, // Anthropic API keys
  /sk-ant-sid01-[a-zA-Z0-9_-]{20,}/g, // Anthropic session keys
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, // JWT-like
  /\bBearer\s+[A-Za-z0-9._-]{10,}\b/gi, // Bearer token (min length to avoid false positives)
  /\bBasic\s+[A-Za-z0-9+/=]{10,}/gi, // Basic auth
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, // PEM blocks
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS Access Key ID
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, // High-entropy base64 (40+ chars)
  /\b[a-fA-F0-9]{64,}\b/g, // Hex-encoded secrets (64+ chars)
  /Authorization:\s*\S+/gi, // Authorization headers
];
const URL_CRED_PATTERN = /\/\/[^/]+:[^/]+@/g;

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
 * Recursively redacts sensitive information from objects and arrays.
 */
export function redactObject(obj: unknown): unknown {
  if (typeof obj === "string") {
    return redact(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = redactObject(value);
    }
    return result;
  }
  return obj;
}

/**
 * Redacts sensitive environment variable values if the name matches certain patterns.
 */
export function redactEnvValue(name: string, value: string): string {
  const sensitiveNames = [
    /PASS(WOR)?D$/i,
    /PRIVATE_KEY$/i,
    /CLIENT_SECRET$/i,
    /BEARER$/i,
    /AUTH/i,
    /COOKIE/i,
    /SESSION/i,
    /SIGNING/i,
    /WEBHOOK/i,
    /DSN$/i,
    /CREDENTIAL/i,
    /(^|_)KEY$/i,
    /API_KEY$/i,
    /TOKEN$/i,
    /SECRET$/i,
    /DATABASE_URL$/i,
  ];
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
    const message = stripAnsi(redact(err.message));
    if (verbose && err.stack) {
      return `${message}\n${stripAnsi(redact(err.stack))}`;
    }
    return message;
  }
  return stripAnsi(redact(String(err)));
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
  error: (msg: string | Error, verbose?: boolean) => {
    const isVerbose = verbose ?? process.argv.includes("--verbose");
    if (msg instanceof Error) {
      console.error(chalk.red(`[ERROR] ${sanitizeError(msg, isVerbose)}`));
    } else {
      console.error(chalk.red(`[ERROR] ${redact(msg)}`));
    }
  },
  debug: (msg: string, verbose?: boolean) => {
    const isVerbose = verbose ?? process.argv.includes("--verbose");
    if (isVerbose) console.error(chalk.gray(`[DEBUG] ${redact(msg)}`));
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
