import { config as loadDotenv } from "dotenv";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { ShipSpecConfigSchema, type ShipSpecConfig } from "./schema.js";

const CONFIG_FILES = ["shipspec.json", ".shipspecrc", ".shipspecrc.json"];

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object | undefined | null
      ? DeepPartial<NonNullable<T[P]>>
      : T[P];
};

export async function loadConfig(
  cwd: string = process.cwd(),
  overrides: Partial<ShipSpecConfig> = {}
): Promise<ShipSpecConfig> {
  loadDotenv({ path: join(cwd, ".env") });

  let fileConfig: DeepPartial<ShipSpecConfig> = {};
  for (const filename of CONFIG_FILES) {
    const filepath = join(cwd, filename);
    if (existsSync(filepath)) {
      try {
        const content = await readFile(filepath, "utf-8");
        const parsed: unknown = JSON.parse(content);
        const result = ShipSpecConfigSchema.partial().safeParse(parsed);
        if (result.success) {
          fileConfig = result.data as DeepPartial<ShipSpecConfig>;
        }
        break;
      } catch {
        // Silently skip malformed config files
      }
    }
  }

  const envConfig: DeepPartial<ShipSpecConfig> = {
    llm: {
      apiKey:
        process.env.OPENAI_API_KEY ??
        process.env.ANTHROPIC_API_KEY ??
        process.env.MISTRAL_API_KEY ??
        process.env.GOOGLE_API_KEY,
      baseUrl: process.env.OLLAMA_BASE_URL,
    },
    embedding: {
      apiKey: process.env.OPENAI_API_KEY ?? process.env.GOOGLE_API_KEY,
      baseUrl: process.env.OLLAMA_BASE_URL,
    },
    productionalize: {
      webSearch: {
        apiKey: process.env.TAVILY_API_KEY,
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

  return ShipSpecConfigSchema.parse(merged);
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
