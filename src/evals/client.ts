/**
 * LangSmith client wrapper for evaluation framework.
 */
import { Client } from "langsmith";

/**
 * Options for creating a LangSmith client.
 */
export interface LangSmithClientOptions {
  /** API key for LangSmith. Falls back to LANGSMITH_API_KEY env var. */
  apiKey?: string;
  /** Project name for organizing experiments. */
  projectName?: string;
}

/**
 * Creates a LangSmith client with the provided options.
 * @param options - Client configuration options
 * @returns Configured LangSmith Client instance
 */
export function createLangSmithClient(options: LangSmithClientOptions = {}): Client {
  return new Client({
    apiKey: options.apiKey,
  });
}

/**
 * Checks if LangSmith is configured (API key available).
 * @returns true if LANGSMITH_API_KEY is set
 */
export function isLangSmithConfigured(): boolean {
  return !!process.env.LANGSMITH_API_KEY;
}
