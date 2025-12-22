import chalk from "chalk";

/**
 * Logger utility for CLI output.
 * Uses stderr for all log messages to keep stdout clean for piping.
 */

/**
 * Maximum safe string length for redaction operations.
 * Prevents ReDoS attacks by limiting input size to ~50KB of text.
 */
const MAX_REDACTION_LENGTH = 50000;

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,1000}/g, // OpenAI-style keys (bounded)
  /sk-ant-[a-zA-Z0-9_-]{10,1000}/g, // Anthropic API keys (bounded)
  /sk-ant-sid01-[a-zA-Z0-9_-]{20,1000}/g, // Anthropic session keys (bounded)
  /\beyJ[A-Za-z0-9_-]{10,10000}\.[A-Za-z0-9_-]{10,10000}\.[A-Za-z0-9_-]{10,10000}\b/g, // JWT-like (bounded)
  /\bBearer\s+[A-Za-z0-9._-]{10,10000}\b/gi, // Bearer token (bounded)
  /\bBasic\s+[A-Za-z0-9+/=]{10,10000}/gi, // Basic auth (bounded)
  // PEM blocks - ReDoS-safe: explicit word matching + bounded middle section
  /-----BEGIN [A-Z]+(?: [A-Z]+)*-----[\s\S]{0,10000}?-----END [A-Z]+(?: [A-Z]+)*-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS Access Key ID
  /\b[A-Za-z0-9+/]{40,512}={0,2}\b/g, // High-entropy base64 (bounded to 512 chars to avoid false positives)
  /\b[a-fAF0-9]{64,512}\b/g, // Hex-encoded secrets (bounded to 512 chars to avoid false positives)
  /\b(?:Proxy-)?Authorization:\s*[^\r\n]{1,10000}/gi, // Authorization headers (bounded)
];
// URL credentials - ReDoS-safe: bounded + non-overlapping character classes
const URL_CRED_PATTERN = /\/\/[^/:@]{1,256}:[^/@]{1,256}@/g;

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
 * Safely truncates strings that exceed the maximum redaction length.
 * Long strings are truncated with a marker to indicate data was cut.
 * This provides defense-in-depth protection against ReDoS attacks.
 */
function safeTruncate(text: string): string {
  if (text.length <= MAX_REDACTION_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_REDACTION_LENGTH) + "\n[... truncated for security]";
}

/**
 * Redacts sensitive information from a string.
 * Input is truncated to prevent ReDoS attacks before pattern matching.
 */
export function redact(text: string): string {
  const safe = safeTruncate(text);
  let redacted = safe;
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
