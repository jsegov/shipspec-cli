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
   * Returns a sanitized error message suitable for production output.
   * In production mode (without debug), only shows the message and error code.
   * In debug mode, includes stack traces and nested error details.
   */
  toPublicString(options: { debug?: boolean } = {}): string {
    const isDebug = options.debug ?? process.env.SHIPSPEC_DEBUG_DIAGNOSTICS === "1";
    const isProduction = process.env.NODE_ENV === "production";

    // In production without debug, return minimal error info
    if (isProduction && !isDebug) {
      return `${this.message} [Error Code: ${this.name}]`;
    }

    // In debug mode or non-production, include full details
    let result = this.message;
    if (this.stack && isDebug) {
      result += `\n${this.stack}`;
    }
    if (this.originalError instanceof Error && isDebug) {
      result += `\nCaused by: ${this.originalError.message}`;
      if (this.originalError.stack) {
        result += `\n${this.originalError.stack}`;
      }
    }
    return result;
  }
}
