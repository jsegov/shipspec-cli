/**
 * Centralized utility for redacting sensitive information (secrets, keys, tokens)
 * from strings and structured objects.
 */

/**
 * Represents a value that has been redacted. Any property value may be
 * replaced with the string "[REDACTED]" if its key matches sensitive patterns,
 * regardless of the original value's type (number, boolean, object, etc.).
 *
 * @example
 * // Input: { password: 12345, name: "John" }
 * // Output type: { password: number | string, name: string }
 * // Actual output: { password: "[REDACTED]", name: "John" }
 */
export type Redacted<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Redacted<U>[]
    : T extends object
      ? { [K in keyof T]: Redacted<T[K]> | string }
      : T | string;

const MAX_REDACTION_LENGTH = 50000;

/**
 * Maximum length for error messages before regex processing.
 * Error messages are untrusted input (from API responses) and must be
 * bounded to prevent ReDoS attacks. 20KB is generous for error messages.
 */
const MAX_ERROR_MESSAGE_LENGTH = 20000;

/**
 * Truncates error messages to a safe length before regex processing.
 * Per AGENTS.md rules, all regex processing of untrusted input must
 * validate input length first to prevent ReDoS attacks.
 *
 * @param errorMessage - The error message to truncate
 * @returns The truncated error message (max 20KB)
 */
export function safeTruncateForRegex(errorMessage: string): string {
  if (errorMessage.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return errorMessage;
  }
  return errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export const SECRET_PATTERNS = [
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
  /\b[a-fA-F0-9]{64,512}\b/g, // Hex-encoded secrets (bounded to 512 chars to avoid false positives)
  /\b(?:Proxy-)?Authorization:\s*[^\r\n]{1,10000}/gi, // Authorization headers (bounded)
  /\bAIza[0-9A-Za-z-_]{35}\b/g, // Google API Key
  /\bxox[baprs]-[0-9a-zA-Z-]{10,48}\b/g, // Slack tokens (including hyphens)
  /\bgh[pousr]_[0-9a-zA-Z]{32,255}\b/g, // GitHub tokens (lowered min length)
  /\bsk_(?:live|test)_[0-9a-zA-Z]{24,255}\b/g, // Stripe API keys
];

export const URL_CRED_PATTERN = /\/\/[^/:@]{1,256}:[^/@]{1,256}@/g;

export const SENSITIVE_NAMES = [
  /PASS(WOR)?D$/i,
  /PRIVATE_KEY$/i,
  /CLIENT_SECRET$/i,
  /BEARER$/i,
  // AUTH patterns - anchored to avoid false positives (author, authorName, etc.)
  /^AUTH$/i, // exact match: AUTH
  /_AUTH$/i, // ends with _AUTH: BASIC_AUTH, OAUTH_AUTH
  /^AUTH_/i, // starts with AUTH_: AUTH_TOKEN, AUTH_KEY
  /AUTHORIZATION/i, // AUTHORIZATION header/key names
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
  /X-API-KEY/i,
];

/**
 * Safely truncates strings that exceed the maximum redaction length.
 */
export function safeTruncate(text: string): string {
  if (text.length <= MAX_REDACTION_LENGTH) {
    return text;
  }
  return text.slice(0, MAX_REDACTION_LENGTH) + "\n[... truncated for security]";
}

/**
 * Redacts sensitive information from a string.
 */
export function redactText(text: string): string {
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
 *
 * **Important:** This function does NOT preserve the exact input type. When a key
 * matches `SENSITIVE_NAMES` patterns, the value is replaced with the string
 * `"[REDACTED]"` regardless of its original type. The return type `Redacted<T>`
 * reflects this by indicating that any property value may become a string.
 *
 * @example
 * const input = { password: 12345, name: "John" };
 * const result = redactObject(input);
 * // result.password is "[REDACTED]" (string), not 12345 (number)
 * // result.name is "John" (string)
 */
export function redactObject<T>(obj: T): Redacted<T> {
  if (typeof obj === "string") {
    return redactText(obj) as Redacted<T>;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactObject) as Redacted<T>;
  }

  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_NAMES.some((pattern) => pattern.test(key))) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactObject(value);
      }
    }
    return result as Redacted<T>;
  }

  return obj as Redacted<T>;
}
