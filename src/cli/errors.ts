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
}
