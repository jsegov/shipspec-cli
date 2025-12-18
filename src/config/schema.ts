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

export const LLMConfigSchema = z.object({
  provider: ModelProviderSchema.default("openai"),
  modelName: z.string().default("gpt-4-turbo"),
  temperature: z.number().min(0).max(2).default(0),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

export const EmbeddingConfigSchema = z.object({
  provider: ModelProviderSchema.default("openai"),
  modelName: z.string().default("text-embedding-3-small"),
  dimensions: z.number().int().positive().default(1536),
  baseUrl: z.string().url().optional(),
});

export const ShipSpecConfigSchema = z.object({
  projectPath: z.string().default("."),
  vectorDbPath: z.string().default(".ship-spec/lancedb"),
  ignorePatterns: z.array(z.string()).default([
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/*.lock",
    "**/build/**",
    "**/.ship-spec/**",
  ]),
  llm: LLMConfigSchema.default({
    provider: "openai",
    modelName: "gpt-4-turbo",
    temperature: 0,
  }),
  embedding: EmbeddingConfigSchema.default({
    provider: "openai",
    modelName: "text-embedding-3-small",
    dimensions: 1536,
  }),
});

export type ShipSpecConfig = z.infer<typeof ShipSpecConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
