/**
 * Canonical list of all environment variables used by shipspec-cli.
 * This serves as the single source of truth for env var names.
 *
 * Used by:
 * - src/config/loader.ts (runtime validation)
 * - src/test/config/env-parity.test.ts (documentation parity test)
 */
export const ENV_VAR_NAMES = {
  // Node environment
  NODE_ENV: "NODE_ENV",

  // Provider API Keys
  OPENAI_API_KEY: "OPENAI_API_KEY",
  ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
  MISTRAL_API_KEY: "MISTRAL_API_KEY",
  GOOGLE_API_KEY: "GOOGLE_API_KEY",
  TAVILY_API_KEY: "TAVILY_API_KEY",

  // Base URLs
  OLLAMA_BASE_URL: "OLLAMA_BASE_URL",

  // Dotenv Control
  SHIPSPEC_LOAD_DOTENV: "SHIPSPEC_LOAD_DOTENV",
  SHIPSPEC_DOTENV_OVERRIDE: "SHIPSPEC_DOTENV_OVERRIDE",
  SHIPSPEC_DOTENV_OVERRIDE_ACK: "SHIPSPEC_DOTENV_OVERRIDE_ACK",
  SHIPSPEC_DOTENV_PATH: "SHIPSPEC_DOTENV_PATH",

  // Configuration Control
  SHIPSPEC_STRICT_CONFIG: "SHIPSPEC_STRICT_CONFIG",

  // Debug Flags
  SHIPSPEC_DEBUG_DIAGNOSTICS: "SHIPSPEC_DEBUG_DIAGNOSTICS",
  ALLOW_LOCALHOST_LLM: "ALLOW_LOCALHOST_LLM",
} as const;

/**
 * Array of all environment variable names for iteration.
 */
export const ALL_ENV_VARS = Object.values(ENV_VAR_NAMES);

/**
 * Environment variables that are required in certain contexts.
 */
export const CONDITIONAL_REQUIRED_VARS = {
  // Required if using OpenAI provider
  OPENAI_API_KEY: ["llm.provider=openai", "embedding.provider=openai"],
  // Required if using Tavily web search
  TAVILY_API_KEY: ["productionalize.webSearch.provider=tavily"],
  // Required in production if SHIPSPEC_LOAD_DOTENV=1
  SHIPSPEC_DOTENV_PATH: ["NODE_ENV=production && SHIPSPEC_LOAD_DOTENV=1"],
  // Required if SHIPSPEC_DOTENV_OVERRIDE=1 in production
  SHIPSPEC_DOTENV_OVERRIDE_ACK: ["NODE_ENV=production && SHIPSPEC_DOTENV_OVERRIDE=1"],
} as const;
