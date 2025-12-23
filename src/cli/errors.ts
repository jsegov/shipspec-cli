import { redactText, stripAnsi } from "../utils/logger.js";

/**
 * Sanitizes a string by redacting secrets and stripping ANSI codes.
 */
function sanitize(text: string): string {
  return stripAnsi(redactText(text));
}

export class CliError extends Error {
  constructor(public message: string) {
    super(message);
    this.name = "CliError";
  }
}

export class CliUsageError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export class CliRuntimeError extends CliError {
  constructor(
    message: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "CliRuntimeError";
  }

  /**
   * Checks if debug diagnostics are enabled.
   * In production, requires explicit acknowledgement via SHIPSPEC_DEBUG_DIAGNOSTICS_ACK.
   */
  private isDebugEnabled(options: { debug?: boolean }): boolean {
    const isProduction = process.env.NODE_ENV === "production";
    const debugEnvSet = process.env.SHIPSPEC_DEBUG_DIAGNOSTICS === "1";
    const debugAckSet = process.env.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK === "I_UNDERSTAND_SECURITY_RISK";

    // Explicit option overrides environment
    if (options.debug !== undefined) {
      // In production, explicit debug=true still requires acknowledgement
      if (isProduction && options.debug) {
        return debugAckSet;
      }
      return options.debug;
    }

    // Environment-based: in production, require both env var and ack
    if (isProduction) {
      return debugEnvSet && debugAckSet;
    }

    // Non-production: env var alone is sufficient
    return debugEnvSet;
  }

  /**
   * Returns a sanitized error message suitable for production output.
   * All output is sanitized (secrets redacted, ANSI stripped) regardless of mode.
   *
   * In production mode (without debug), only shows the message and error code.
   * In debug mode:
   *   - Non-production: includes sanitized stack traces and nested error details
   *   - Production: requires SHIPSPEC_DEBUG_DIAGNOSTICS_ACK=I_UNDERSTAND_SECURITY_RISK
   */
  toPublicString(options: { debug?: boolean } = {}): string {
    const isDebug = this.isDebugEnabled(options);
    const isProduction = process.env.NODE_ENV === "production";

    // Always sanitize the message
    const safeMessage = sanitize(this.message);

    // In production without debug, return minimal error info
    if (isProduction && !isDebug) {
      return `${safeMessage} [Error Code: ${this.name}]`;
    }

    // Build result with sanitized components
    let result = safeMessage;

    if (this.stack && isDebug) {
      result += `\n${sanitize(this.stack)}`;
    }

    if (this.originalError instanceof Error && isDebug) {
      result += `\nCaused by: ${sanitize(this.originalError.message)}`;
      if (this.originalError.stack) {
        result += `\n${sanitize(this.originalError.stack)}`;
      }
    }

    return result;
  }
}
