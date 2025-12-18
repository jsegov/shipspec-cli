import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Creates a temporary directory for testing.
 * Returns the path to the created directory.
 */
export async function createTempDir(): Promise<string> {
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, "shipspec-test-");
  return await mkdtemp(prefix);
}

/**
 * Removes a temporary directory and all its contents.
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await rm(dirPath, { recursive: true, force: true });
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
