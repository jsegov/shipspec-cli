/**
 * Base class for CLI-related errors.
 */
export class CliError extends Error {
  constructor(public message: string) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Error thrown when the user provides invalid arguments or usage.
 */
export class CliUsageError extends CliError {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/**
 * Error thrown when an operational failure occurs during command execution.
 */
export class CliRuntimeError extends CliError {
  constructor(
    message: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "CliRuntimeError";
  }
}
