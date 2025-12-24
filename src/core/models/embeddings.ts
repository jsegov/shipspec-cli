import { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import { OllamaEmbeddings } from "@langchain/ollama";
import type { EmbeddingConfig } from "../../config/schema.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function createEmbeddingsModel(
  config: EmbeddingConfig,
  apiKey?: string
): Promise<Embeddings> {
  const maxRetries = config.maxRetries;

  switch (config.provider) {
    case "openrouter":
      return Promise.resolve(
        new OpenAIEmbeddings({
          model: config.modelName,
          // dimensions omitted here - resolved at runtime if "auto" in productionalize.ts
          apiKey: apiKey ?? config.apiKey ?? process.env.OPENROUTER_API_KEY,
          configuration: {
            baseURL: OPENROUTER_BASE_URL,
          },
          maxRetries,
        })
      );
    case "ollama":
      return Promise.resolve(
        new OllamaEmbeddings({
          model: config.modelName,
          baseUrl: config.baseUrl ?? "http://localhost:11434",
          maxRetries,
        })
      );
    default: {
      const exhaustiveCheck: never = config.provider;
      return Promise.reject(
        new Error(`Unsupported embedding provider: ${String(exhaustiveCheck)}`)
      );
    }
  }
}
