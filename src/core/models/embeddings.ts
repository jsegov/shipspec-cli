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
          // OpenRouter doesn't support the dimensions parameter - it returns whatever the model provides
          // We use config.dimensions only for LanceDB configuration, not for API calls
          apiKey: apiKey ?? config.apiKey ?? process.env.OPENROUTER_API_KEY,
          configuration: {
            baseURL: OPENROUTER_BASE_URL,
          },
          // Explicitly set encoding format to avoid OpenAI SDK bug with OpenRouter
          // See: https://github.com/openai/openai-node/issues/1542
          // Without this, the SDK's internal base64 handling corrupts embeddings from some models
          encodingFormat: "float",
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
