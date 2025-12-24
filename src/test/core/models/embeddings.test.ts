import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEmbeddingsModel } from "../../../core/models/embeddings.js";
import type { EmbeddingConfig } from "../../../config/schema.js";

vi.mock("@langchain/openai", () => {
  class MockOpenAIEmbeddings {
    model: string;
    dimensions?: number;
    apiKey?: string;
    maxRetries?: number;
    configuration?: { baseURL: string };
    constructor(config: {
      model: string;
      dimensions?: number;
      apiKey?: string;
      maxRetries?: number;
      configuration?: { baseURL: string };
    }) {
      this.model = config.model;
      this.dimensions = config.dimensions;
      this.apiKey = config.apiKey;
      this.maxRetries = config.maxRetries;
      this.configuration = config.configuration;
    }
  }
  return {
    OpenAIEmbeddings: vi.fn(MockOpenAIEmbeddings),
  };
});

vi.mock("@langchain/ollama", () => {
  class MockOllamaEmbeddings {
    model: string;
    baseUrl: string;
    maxRetries?: number;
    constructor(config: { model: string; baseUrl: string; maxRetries?: number }) {
      this.model = config.model;
      this.baseUrl = config.baseUrl;
      this.maxRetries = config.maxRetries;
    }
  }
  return {
    OllamaEmbeddings: vi.fn(MockOllamaEmbeddings),
  };
});

describe("embeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createEmbeddingsModel", () => {
    it("returns OpenAIEmbeddings when provider is 'openrouter'", async () => {
      const config: EmbeddingConfig = {
        provider: "openrouter",
        modelName: "mistralai/codestral-embed-2505",
        dimensions: "auto",
        apiKey: "test-api-key",
        maxRetries: 3,
      };

      const { OpenAIEmbeddings } = await import("@langchain/openai");
      const result = await createEmbeddingsModel(config);

      expect(OpenAIEmbeddings).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "mistralai/codestral-embed-2505",
          apiKey: "test-api-key",
          maxRetries: 3,
          configuration: {
            baseURL: "https://openrouter.ai/api/v1",
          },
        })
      );
      expect(result).toBeDefined();
    });

    it("uses process.env.OPENROUTER_API_KEY when apiKey not provided", async () => {
      const originalKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = "env-api-key";

      const config: EmbeddingConfig = {
        provider: "openrouter",
        modelName: "mistralai/codestral-embed-2505",
        dimensions: "auto",
        maxRetries: 3,
      };

      const { OpenAIEmbeddings } = await import("@langchain/openai");
      await createEmbeddingsModel(config);

      expect(OpenAIEmbeddings).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "env-api-key",
        })
      );

      if (originalKey) {
        process.env.OPENROUTER_API_KEY = originalKey;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    });

    it("returns OllamaEmbeddings when provider is 'ollama'", async () => {
      const config: EmbeddingConfig = {
        provider: "ollama",
        modelName: "nomic-embed-text",
        dimensions: 768,
        baseUrl: "http://localhost:11434",
        maxRetries: 3,
      };

      const { OllamaEmbeddings } = await import("@langchain/ollama");
      const result = await createEmbeddingsModel(config);

      expect(OllamaEmbeddings).toHaveBeenCalledWith({
        model: "nomic-embed-text",
        baseUrl: "http://localhost:11434",
        maxRetries: 3,
      });
      expect(result).toBeDefined();
    });

    it("throws error for unsupported provider", async () => {
      const config = {
        provider: "unsupported" as EmbeddingConfig["provider"],
        modelName: "test-model",
        dimensions: 1024,
        maxRetries: 3,
      };

      await expect(createEmbeddingsModel(config as EmbeddingConfig)).rejects.toThrow(
        "Unsupported embedding provider: unsupported"
      );
    });
  });
});
