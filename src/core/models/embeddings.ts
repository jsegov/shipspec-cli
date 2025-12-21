import { Embeddings } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import { OllamaEmbeddings } from "@langchain/ollama";
import type { EmbeddingConfig } from "../../config/schema.js";

export function createEmbeddingsModel(config: EmbeddingConfig): Embeddings {
  const maxRetries = config.maxRetries;

  switch (config.provider) {
    case "openai":
      return new OpenAIEmbeddings({
        model: config.modelName,
        dimensions: config.dimensions,
        apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
        maxRetries,
      });
    case "ollama":
      return new OllamaEmbeddings({
        model: config.modelName,
        baseUrl: config.baseUrl ?? "http://localhost:11434",
        maxRetries,
      });
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }
}
