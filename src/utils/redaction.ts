/**
 * Centralized utility for redacting sensitive information (secrets, keys, tokens)
 * from strings and structured objects.
 */

const MAX_REDACTION_LENGTH = 50000;

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
 */
export function redactObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return redactText(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactObject) as unknown as T;
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
    return result as unknown as T;
  }

  return obj;
}
