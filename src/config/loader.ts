import { config as loadDotenv } from "dotenv";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, isAbsolute } from "path";
import { z } from "zod";
import { ShipSpecConfigSchema, type ShipSpecConfig } from "./schema.js";
import { logger } from "../utils/logger.js";
import { ZodError } from "zod";

const CONFIG_FILES = ["shipspec.json", ".shipspecrc", ".shipspecrc.json"];
const ENV_BOOL = z
  .enum(["0", "1"])
  .optional()
  .transform((v: string | undefined) => v === "1");

const ShipSpecEnvSchema = z.object({
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
  ALLOW_LOCALHOST_LLM: ENV_BOOL,
  SHIPSPEC_ALLOW_LOCALHOST_LLM_ACK: z.string().optional(),
});

export interface ConfigLoaderOptions {
  strict?: boolean;
  configPath?: string;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object | undefined | null
      ? DeepPartial<NonNullable<T[P]>>
      : T[P];
};

export async function loadConfig(
  cwd: string = process.cwd(),
  overrides: DeepPartial<ShipSpecConfig> = {},
  options: ConfigLoaderOptions = {}
): Promise<ShipSpecConfig> {
  const isProduction = process.env.NODE_ENV === "production";
  const explicitDotenvPath = process.env.SHIPSPEC_DOTENV_PATH;
  const shouldLoadDotenv = !isProduction || process.env.SHIPSPEC_LOAD_DOTENV === "1";

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
          `In production, SHIPSPEC_DOTENV_PATH must be an absolute path. Received: ${explicitDotenvPath}`
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
      throw new Error(`Dotenv file not found at: ${explicitDotenvPath}`);
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
    if (env.SHIPSPEC_ALLOW_LOCALHOST_LLM_ACK !== "I_UNDERSTAND_SSRF_RISK") {
      throw new Error(
        "ALLOW_LOCALHOST_LLM=1 is not permitted in production without explicit acknowledgement. " +
          "This flag disables SSRF protections. To proceed, set SHIPSPEC_ALLOW_LOCALHOST_LLM_ACK=I_UNDERSTAND_SSRF_RISK"
      );
    }
    logger.warn(
      "ALLOW_LOCALHOST_LLM enabled in production with explicit acknowledgement. SSRF protections are disabled."
    );
  }

  const isStrict =
    (options.strict ?? false) || env.SHIPSPEC_STRICT_CONFIG || env.NODE_ENV === "production";

  let fileConfig: DeepPartial<ShipSpecConfig> = {};

  // Helper to load and parse a config file
  const loadConfigFile = async (filepath: string): Promise<boolean> => {
    try {
      const content = await readFile(filepath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        const msg = `Malformed JSON in config file: ${filepath}`;
        if (isStrict) {
          throw new Error(msg);
        }
        logger.warn(msg);
        return false;
      }

      const result = ShipSpecConfigSchema.partial().safeParse(parsed);
      if (result.success) {
        fileConfig = result.data as DeepPartial<ShipSpecConfig>;
        logger.debug(`Loaded config from ${filepath}`, true);
        return true;
      } else {
        const msg = `Invalid config in ${filepath}:\n${result.error.issues
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
      throw new Error(`Config file not found: ${configPath}`);
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

  const envConfig: DeepPartial<ShipSpecConfig> = {
    llm: {
      apiKey:
        env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? env.MISTRAL_API_KEY ?? env.GOOGLE_API_KEY,
      baseUrl: env.OLLAMA_BASE_URL,
    },
    embedding: {
      apiKey: env.OPENAI_API_KEY ?? env.GOOGLE_API_KEY,
      baseUrl: env.OLLAMA_BASE_URL,
    },
    productionalize: {
      webSearch: {
        apiKey: env.TAVILY_API_KEY,
      },
    },
  };

  const merged = deepMerge(
    fileConfig as Record<string, unknown>,
    envConfig as Record<string, unknown>,
    overrides as Record<string, unknown>
  );

  // Apply Ollama-specific defaults only if values are unset (undefined)
  // This must happen before Zod parsing to override OpenAI defaults with Ollama defaults
  const embeddingConfig = merged.embedding as Record<string, unknown> | undefined;
  if (embeddingConfig?.provider === "ollama") {
    embeddingConfig.dimensions ??= 768;
    embeddingConfig.modelName ??= "nomic-embed-text";
  }

  try {
    return ShipSpecConfigSchema.parse(merged);
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
