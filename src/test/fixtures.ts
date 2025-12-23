import { mkdtemp, rm, realpath } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";

/**
 * Creates a temporary directory for testing.
 * Returns the path to the created directory.
 */
export async function createTempDir(): Promise<string> {
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, "shipspec-test-");
  const path = await mkdtemp(prefix);
  return resolve(path);
}

/**
 * Removes a temporary directory and all its contents.
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  if (!dirPath || dirPath.trim() === "") {
    throw new Error("cleanupTempDir: dirPath must be a non-empty string");
  }

  const absolutePath = resolve(dirPath);
  const tempRoot = resolve(tmpdir());
  const repoRoot = resolve(process.cwd());

  // Basic guardrails
  if (absolutePath === "/" || absolutePath === repoRoot) {
    throw new Error(`cleanupTempDir: Refusing to delete critical directory: ${absolutePath}`);
  }

  if (absolutePath === tempRoot) {
    throw new Error("cleanupTempDir: Refusing to delete the entire system temp directory");
  }

  // Ensure it's within the temp directory and has our prefix
  if (!absolutePath.startsWith(tempRoot)) {
    throw new Error(`cleanupTempDir: Path is not within system temp directory: ${absolutePath}`);
  }

  const pathSegments = absolutePath.split(/[/\\]/);
  const lastSegment = pathSegments[pathSegments.length - 1];
  if (!lastSegment?.startsWith("shipspec-test-")) {
    throw new Error(
      `cleanupTempDir: Path does not have expected prefix 'shipspec-test-': ${lastSegment ?? "undefined"}`
    );
  }

  try {
    // Use realpath to resolve any symlinks before deletion for extra safety
    // only if the path exists. If it doesn't exist, rm with force: true will handle it.
    let finalPath = absolutePath;
    try {
      finalPath = await realpath(absolutePath);
    } catch {
      // If it doesn't exist, we'll let rm handle it (force: true)
    }

    await rm(finalPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors if directory doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Sample TypeScript code fixture with functions, classes, and interfaces
 */
export const TS_FIXTURE = `
/**
 * Adds two numbers
 * @param a First number
 * @param b Second number
 * @returns Sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Subtracts two numbers
 */
export const subtract = (a: number, b: number): number => {
  return a - b;
};

export class Calculator {
  /**
   * Multiplies two numbers
   */
  multiply(a: number, b: number): number {
    return a * b;
  }

  divide(a: number, b: number): number {
    if (b === 0) throw new Error("Division by zero");
    return a / b;
  }
}

export interface Config {
  debug: boolean;
  apiKey?: string;
}

export type Result<T> = {
  success: boolean;
  data?: T;
  error?: string;
};
`;

/**
 * Sample JavaScript code fixture
 */
export const JS_FIXTURE = `
/**
 * Greets a user
 */
function greet(name) {
  return \`Hello, \${name}!\`;
}

const sayGoodbye = (name) => {
  return \`Goodbye, \${name}!\`;
};

class User {
  constructor(name) {
    this.name = name;
  }

  getName() {
    return this.name;
  }
}
`;

/**
 * Sample Python code fixture with functions, classes, and docstrings
 */
export const PYTHON_FIXTURE = `
"""
Module for mathematical operations
"""

def add(a: int, b: int) -> int:
    """
    Adds two numbers
    
    Args:
        a: First number
        b: Second number
    
    Returns:
        Sum of a and b
    """
    return a + b

def subtract(a, b):
    return a - b

class Calculator:
    """
    A simple calculator class
    """
    
    def multiply(self, a, b):
        """
        Multiplies two numbers
        """
        return a * b
    
    def divide(self, a, b):
        if b == 0:
            raise ValueError("Division by zero")
        return a / b
`;

/**
 * Sample JSON fixture for fallback testing
 */
export const JSON_FIXTURE = `{
  "name": "test",
  "version": "1.0.0",
  "dependencies": {
    "typescript": "^5.0.0"
  }
}`;

/**
 * Sample YAML fixture for fallback testing
 */
export const YAML_FIXTURE = `
name: test
version: 1.0.0
dependencies:
  typescript: ^5.0.0
`;

/**
 * Sample Markdown fixture for fallback testing
 */
export const MARKDOWN_FIXTURE = `# Test Document

This is a test markdown file.

## Section 1

Some content here.

## Section 2

More content.
`;
