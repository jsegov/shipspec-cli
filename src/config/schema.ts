import { z } from "zod";

// Providers supported by LangChain's initChatModel
export const ModelProviderSchema = z.enum([
  "openai",
  "anthropic",
  "ollama",
  "google-vertexai",
  "mistralai",
  "azure-openai",
]);

export type ModelProvider = z.infer<typeof ModelProviderSchema>;

const BaseUrlSchema = z
  .url()
  .refine(
    (val) => {
      try {
        const url = new URL(val);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        if (url.username || url.password) return false;
        if (url.hostname === "169.254.169.254") return false;
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
          if (process.env.NODE_ENV === "production") return false;
          if (process.env.ALLOW_LOCALHOST_LLM !== "1") return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        "Invalid baseUrl. Must be http/https, no credentials, not a restricted IP, and localhost is strictly prohibited in production (requires ALLOW_LOCALHOST_LLM=1 in development)",
    }
  )
  .transform((val) => (val.endsWith("/") ? val.slice(0, -1) : val));

export const LLMConfigSchema = z.object({
  provider: ModelProviderSchema.default("openai"),
  modelName: z.string().default("gpt-5.2-2025-12-11"),
  temperature: z.number().min(0).max(2).default(0),
  baseUrl: BaseUrlSchema.optional(),
  apiKey: z.string().optional(),
  maxRetries: z.number().int().min(0).max(10).default(3),
  timeout: z.number().int().positive().optional(),
  maxContextTokens: z.number().int().positive().default(16000),
  reservedOutputTokens: z.number().int().positive().default(4000),
});

export const EmbeddingConfigSchema = z.object({
  provider: ModelProviderSchema.default("openai"),
  modelName: z.string().default("text-embedding-3-large"),
  dimensions: z.number().int().positive().default(3072),
  baseUrl: BaseUrlSchema.optional(),
  apiKey: z.string().optional(),
  maxRetries: z.number().int().min(0).max(10).default(3),
});

export const CheckpointConfigSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(["memory", "sqlite"]).default("memory"),
  sqlitePath: z.string().optional(),
});

export const WebSearchConfigSchema = z.object({
  provider: z.enum(["tavily", "duckduckgo"]).default("tavily"),
  apiKey: z.string().optional(),
});

export const SASTConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tools: z.array(z.enum(["semgrep", "gitleaks", "trivy"])).default([]),
});

export const ProductionalizeConfigSchema = z.object({
  webSearch: WebSearchConfigSchema.optional(),
  sast: SASTConfigSchema.optional(),
  coreCategories: z
    .array(z.string())
    .default(["security", "soc2", "code-quality", "dependencies", "testing", "configuration"]),
});

export const ShipSpecConfigSchema = z
  .object({
    projectPath: z.string().default("."),
    vectorDbPath: z.string().default(".ship-spec/lancedb"),
    ignorePatterns: z
      .array(z.string())
      .default([
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/*.lock",
        "**/build/**",
        "**/.ship-spec/**",
      ]),
    llm: LLMConfigSchema.default({
      provider: "openai",
      modelName: "gpt-5.2-2025-12-11",
      temperature: 0,
      maxRetries: 3,
      maxContextTokens: 16000,
      reservedOutputTokens: 4000,
    }),
    embedding: EmbeddingConfigSchema.default({
      provider: "openai",
      modelName: "text-embedding-3-large",
      dimensions: 3072,
      maxRetries: 3,
    }),
    checkpoint: CheckpointConfigSchema.default({
      enabled: false,
      type: "memory",
    }),
    productionalize: ProductionalizeConfigSchema.default({
      coreCategories: [
        "security",
        "soc2",
        "code-quality",
        "dependencies",
        "testing",
        "configuration",
      ],
    }),
  })
  .strict();

export type ShipSpecConfig = z.infer<typeof ShipSpecConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type CheckpointConfig = z.infer<typeof CheckpointConfigSchema>;
export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>;
export type SASTConfig = z.infer<typeof SASTConfigSchema>;
export type ProductionalizeConfig = z.infer<typeof ProductionalizeConfigSchema>;
