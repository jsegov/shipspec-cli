import { config as loadDotenv } from "dotenv";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, isAbsolute, basename } from "path";
import { z } from "zod";
import { ShipSpecConfigSchema, type ShipSpecConfig } from "./schema.js";
import { logger } from "../utils/logger.js";
import { ZodError } from "zod";

/**
 * Formats a file path for logging/error messages to prevent information disclosure.
 * - In production: always returns basename only
 * - In non-production with verbose: returns full path
 * - In non-production without verbose: returns basename
 */
function formatPathForLog(path: string, verbose = false): string {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction || !verbose) {
    return basename(path);
  }
  return path;
}

const CONFIG_FILES = ["shipspec.json", ".shipspecrc", ".shipspecrc.json"];
const ENV_BOOL = z
  .enum(["0", "1"])
  .optional()
  .transform((v: string | undefined) => v === "1");

export const ShipSpecEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.url().optional(),
  SHIPSPEC_LOAD_DOTENV: ENV_BOOL,
  SHIPSPEC_DOTENV_OVERRIDE: ENV_BOOL,
  SHIPSPEC_DOTENV_OVERRIDE_ACK: z.string().optional(),
  SHIPSPEC_STRICT_CONFIG: ENV_BOOL,
  SHIPSPEC_DOTENV_PATH: z.string().optional(),
  SHIPSPEC_DEBUG_DIAGNOSTICS: ENV_BOOL,
  SHIPSPEC_DEBUG_DIAGNOSTICS_ACK: z.string().optional(),
  ALLOW_LOCALHOST_LLM: ENV_BOOL,
});

export interface ConfigLoaderOptions {
  strict?: boolean;
  configPath?: string;
  verbose?: boolean;
  allowImplicitDotenv?: boolean;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object | undefined | null
      ? DeepPartial<NonNullable<T[P]>>
      : T[P];
};

export interface ShipSpecSecrets {
  llmApiKey?: string;
  embeddingApiKey?: string;
  tavilyApiKey?: string;
}

const pickFirstDefined = <T>(...values: (T | undefined)[]): T | undefined =>
  values.find((value) => value !== undefined);

export function stripConfigSecrets(config: DeepPartial<ShipSpecConfig>): void {
  const llmConfig = config.llm as { apiKey?: string } | undefined;
  const embeddingConfig = config.embedding as { apiKey?: string } | undefined;
  const webSearchConfig = config.productionalize?.webSearch as { apiKey?: string } | undefined;

  if (llmConfig) {
    delete llmConfig.apiKey;
  }
  if (embeddingConfig) {
    delete embeddingConfig.apiKey;
  }
  if (webSearchConfig) {
    delete webSearchConfig.apiKey;
  }
}

export async function loadConfig(
  cwd: string = process.cwd(),
  overrides: DeepPartial<ShipSpecConfig> = {},
  options: ConfigLoaderOptions = {}
): Promise<{ config: ShipSpecConfig; secrets: ShipSpecSecrets }> {
  const isProduction = process.env.NODE_ENV === "production";
  const explicitDotenvPath = process.env.SHIPSPEC_DOTENV_PATH;
  const inCI = process.env.CI === "true" || process.env.CI === "1";

  // In production: require explicit opt-in
  // In CI (non-production): require explicit opt-in to avoid config injection
  // In local dev: allow unless explicitly disabled
  const shouldLoadDotenv = isProduction
    ? process.env.SHIPSPEC_LOAD_DOTENV === "1"
    : inCI
      ? process.env.SHIPSPEC_LOAD_DOTENV === "1"
      : (options.allowImplicitDotenv ?? true);

  if (shouldLoadDotenv) {
    // ... same logic for dotenvPath ...
    let dotenvPath: string | undefined;

    if (isProduction) {
      if (!explicitDotenvPath) {
        throw new Error(
          "In production, SHIPSPEC_DOTENV_PATH must be set to load a .env file. Implicit loading from CWD is disabled for security."
        );
      }
      if (!isAbsolute(explicitDotenvPath)) {
        throw new Error(
          "In production, SHIPSPEC_DOTENV_PATH must be an absolute path. Full paths are hidden for security in production."
        );
      }
      dotenvPath = explicitDotenvPath;

      if (process.env.SHIPSPEC_DOTENV_OVERRIDE === "1") {
        if (process.env.SHIPSPEC_DOTENV_OVERRIDE_ACK !== "I_UNDERSTAND") {
          throw new Error(
            "In production, overriding environment variables via .env requires explicit acknowledgement. Set SHIPSPEC_DOTENV_OVERRIDE_ACK=I_UNDERSTAND to proceed."
          );
        }
      }
    } else {
      dotenvPath = explicitDotenvPath ?? join(cwd, ".env");
    }

    if (dotenvPath && existsSync(dotenvPath)) {
      loadDotenv({
        path: dotenvPath,
        override: process.env.SHIPSPEC_DOTENV_OVERRIDE === "1",
      });
      if (isProduction) {
        logger.warn("Loaded dotenv configuration in production (path hidden for security)");
      } else {
        logger.debug(`Loaded .env configuration from ${dotenvPath}`, true);
      }
    } else if (explicitDotenvPath) {
      const isVerbose = options.verbose ?? false;
      const safePath = formatPathForLog(explicitDotenvPath, isVerbose);
      const isProductionRuntime = process.env.NODE_ENV === "production";
      const pathHint = isProductionRuntime
        ? " Full paths are hidden for security in production."
        : isVerbose
          ? ""
          : " Use --verbose to see the full path.";
      throw new Error(`Dotenv file not found: ${safePath}.${pathHint}`);
    }
  }

  // Parse environment variables after potentially loading .env
  const envParsed = ShipSpecEnvSchema.safeParse(process.env);
  if (!envParsed.success) {
    const invalidVars = envParsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${invalidVars}`);
  }
  const env = envParsed.data;

  // Production guardrail for ALLOW_LOCALHOST_LLM
  if (env.NODE_ENV === "production" && env.ALLOW_LOCALHOST_LLM) {
    throw new Error(
      "ALLOW_LOCALHOST_LLM=1 is strictly prohibited in production. " +
        "Localhost LLM target is only permitted in development mode for security reasons (SSRF protection)."
    );
  }

  const isStrict =
    (options.strict ?? false) || env.SHIPSPEC_STRICT_CONFIG || env.NODE_ENV === "production";

  let fileConfig: DeepPartial<ShipSpecConfig> = {};

  // Helper to load and parse a config file
  const loadConfigFile = async (filepath: string): Promise<boolean> => {
    const isVerbose = options.verbose ?? false;
    const safePath = formatPathForLog(filepath, isVerbose);

    try {
      const content = await readFile(filepath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        const msg = `Malformed JSON in config file: ${safePath}`;
        if (isStrict) {
          throw new Error(msg);
        }
        logger.warn(msg);
        return false;
      }

      const result = ShipSpecConfigSchema.partial().safeParse(parsed);
      if (result.success) {
        fileConfig = result.data as DeepPartial<ShipSpecConfig>;
        logger.debug(`Loaded config from ${safePath}`, true);
        return true;
      } else {
        const msg = `Invalid config in ${safePath}:\n${result.error.issues
          .map((i) => `- ${i.path.join(".")}: ${i.message}`)
          .join("\n")}`;
        if (isStrict) {
          throw new Error(msg);
        }
        logger.warn(msg);
        return false;
      }
    } catch (err) {
      if (isStrict) throw err;
      return false;
    }
  };

  // If explicit config path provided, use it directly
  if (options.configPath) {
    const configPath = isAbsolute(options.configPath)
      ? options.configPath
      : join(cwd, options.configPath);

    if (!existsSync(configPath)) {
      const isVerbose = options.verbose ?? false;
      const safePath = formatPathForLog(configPath, isVerbose);
      const isProductionRuntime = process.env.NODE_ENV === "production";
      const pathHint = isProductionRuntime
        ? " Full paths are hidden for security in production."
        : isVerbose
          ? ""
          : " Use --verbose to see the full path.";
      throw new Error(`Config file not found: ${safePath}.${pathHint}`);
    }
    await loadConfigFile(configPath);
  } else {
    // Search for config files in cwd
    for (const filename of CONFIG_FILES) {
      const filepath = join(cwd, filename);
      if (existsSync(filepath)) {
        const loaded = await loadConfigFile(filepath);
        if (loaded) break;
      }
    }
  }

  if (Object.keys(fileConfig).length === 0) {
    logger.debug("No config file found, using defaults and environment variables", true);
  }

  // Extract secrets for separate return
  const secrets: ShipSpecSecrets = {
    llmApiKey:
      env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? env.MISTRAL_API_KEY ?? env.GOOGLE_API_KEY,
    embeddingApiKey: env.OPENAI_API_KEY ?? env.GOOGLE_API_KEY,
    tavilyApiKey: env.TAVILY_API_KEY,
  };

  const overrideLlmApiKey = (overrides.llm as { apiKey?: string } | undefined)?.apiKey;
  const overrideEmbeddingApiKey = (overrides.embedding as { apiKey?: string } | undefined)?.apiKey;
  const overrideWebSearchApiKey = (
    overrides.productionalize?.webSearch as { apiKey?: string } | undefined
  )?.apiKey;

  const fileLlmApiKey = (fileConfig.llm as { apiKey?: string } | undefined)?.apiKey;
  const fileEmbeddingApiKey = (fileConfig.embedding as { apiKey?: string } | undefined)?.apiKey;
  const fileWebSearchApiKey = (
    fileConfig.productionalize?.webSearch as { apiKey?: string } | undefined
  )?.apiKey;

  secrets.llmApiKey = pickFirstDefined(overrideLlmApiKey, secrets.llmApiKey, fileLlmApiKey);
  secrets.embeddingApiKey = pickFirstDefined(
    overrideEmbeddingApiKey,
    secrets.embeddingApiKey,
    fileEmbeddingApiKey
  );
  secrets.tavilyApiKey = pickFirstDefined(
    overrideWebSearchApiKey,
    secrets.tavilyApiKey,
    fileWebSearchApiKey
  );

  // Final config object should NOT contain secrets from env
  const envConfig: DeepPartial<ShipSpecConfig> = {
    llm: {
      baseUrl: env.OLLAMA_BASE_URL,
    },
    embedding: {
      baseUrl: env.OLLAMA_BASE_URL,
    },
  };

  const merged = deepMerge(
    fileConfig as Record<string, unknown>,
    envConfig as Record<string, unknown>,
    overrides as Record<string, unknown>
  ) as DeepPartial<ShipSpecConfig>;

  stripConfigSecrets(merged);

  // Apply Ollama-specific defaults only if values are unset (undefined)
  // This must happen before Zod parsing to override OpenAI defaults with Ollama defaults
  const embeddingConfig = merged.embedding as Record<string, unknown> | undefined;
  if (embeddingConfig?.provider === "ollama") {
    embeddingConfig.dimensions ??= 768;
    embeddingConfig.modelName ??= "nomic-embed-text";
  }

  try {
    const config = ShipSpecConfigSchema.parse(merged);
    return { config, secrets };
  } catch (err) {
    if (err instanceof ZodError) {
      const msg = `Final merged configuration is invalid:\n${err.issues
        .map((i) => `- ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`;
      throw new Error(msg);
    }
    throw err;
  }
}

function isObject(item: unknown): item is Record<string, unknown> {
  return !!item && typeof item === "object" && !Array.isArray(item);
}

function deepMerge(
  target: Record<string, unknown>,
  ...sources: Record<string, unknown>[]
): Record<string, unknown> {
  const result = { ...target };

  for (const source of sources) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = result[key];

        if (isObject(sourceValue) && isObject(targetValue)) {
          result[key] = deepMerge(targetValue, sourceValue);
        } else if (sourceValue !== undefined) {
          result[key] = sourceValue;
        }
      }
    }
  }

  return result;
}
