import { execFile, type ExecFileOptions } from "child_process";
import { promisify } from "util";
import os from "os";
import fs from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

export interface ExecWithLimitsOptions extends Omit<ExecFileOptions, "timeout" | "maxBuffer"> {
  timeoutSeconds?: number;
  maxBufferMB?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ExecError extends Error {
  constructor(
    message: string,
    public readonly stdout?: string,
    public readonly stderr?: string,
    public readonly exitCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ExecError";
  }
}

export class ToolMissingError extends ExecError {
  constructor(tool: string, installInstructions?: string) {
    super(`${tool} not found. ${installInstructions ?? ""}`);
    this.name = "ToolMissingError";
  }
}

export class TimeoutError extends ExecError {
  constructor(tool: string, timeout: number) {
    super(`${tool} timed out after ${String(timeout)} seconds`);
    this.name = "TimeoutError";
  }
}

/**
 * Executes a file with safe arguments, timeouts, and buffer limits.
 * Prefer this over exec() to avoid shell injection and resource exhaustion.
 */
export async function execFileWithLimits(
  file: string,
  args: string[],
  options: ExecWithLimitsOptions = {}
): Promise<ExecResult> {
  const timeout = (options.timeoutSeconds ?? 300) * 1000; // Default 5 minutes
  const maxBuffer = (options.maxBufferMB ?? 10) * 1024 * 1024; // Default 10MB

  const resolvedPath = await resolveBinary(file);

  try {
    const { stdout: rawStdout, stderr: rawStderr } = await execFileAsync(resolvedPath, args, {
      ...options,
      timeout,
      maxBuffer,
      // Inherit minimal env if not provided
      env: options.env ?? {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        ...getToolPathOverrides(),
      },
    });

    const stdout = typeof rawStdout === "string" ? rawStdout : rawStdout.toString();
    const stderr = typeof rawStderr === "string" ? rawStderr : rawStderr.toString();

    return {
      stdout,
      stderr,
      exitCode: 0,
    };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: string | number;
      signal?: string;
    };
    const stdout =
      typeof error.stdout === "string" ? error.stdout : (error.stdout?.toString() ?? "");
    const stderr =
      typeof error.stderr === "string" ? error.stderr : (error.stderr?.toString() ?? "");
    const exitCode = error.code;

    if (error.signal === "SIGTERM" || error.signal === "SIGKILL") {
      throw new TimeoutError(file, timeout / 1000);
    }

    if (error.code === "ENOENT") {
      throw new ToolMissingError(file);
    }

    throw new ExecError(
      `Execution of ${file} failed with exit code ${String(exitCode)}`,
      stdout,
      stderr,
      typeof exitCode === "number" ? exitCode : undefined,
      error
    );
  }
}

/**
 * Resolves a binary name to an absolute path.
 * Checks tool-specific env vars (e.g., GITLEAKS_PATH) first.
 */
async function resolveBinary(name: string): Promise<string> {
  if (path.isAbsolute(name)) {
    return name;
  }

  // Check for environment overrides
  const overrideKey = `${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_PATH`;
  const override = process.env[overrideKey];
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error(`Environment override ${overrideKey} must be an absolute path: ${override}`);
    }
    return override;
  }

  // Simple 'which' implementation
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  const extensions = os.platform() === "win32" ? [".exe", ".cmd", ".bat", ".sh"] : [""];

  for (const p of paths) {
    for (const ext of extensions) {
      const fullPath = path.join(p, name + ext);
      try {
        await fs.access(fullPath, fs.constants.X_OK);
        return fullPath;
      } catch {
        continue;
      }
    }
  }

  throw new ToolMissingError(name);
}

function getToolPathOverrides(): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {};
  const tools = ["SEMGREP", "GITLEAKS", "TRIVY"];
  for (const tool of tools) {
    const key = `${tool}_PATH`;
    if (process.env[key]) {
      overrides[key] = process.env[key];
    }
  }
  return overrides;
}
