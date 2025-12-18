import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEmbeddingsModel } from "../../../core/models/embeddings.js";
import type { EmbeddingConfig } from "../../../config/schema.js";

vi.mock("@langchain/openai", () => {
  class MockOpenAIEmbeddings {
    model: string;
    dimensions?: number;
    apiKey?: string;
    constructor(config: { model: string; dimensions?: number; apiKey?: string }) {
      this.model = config.model;
      this.dimensions = config.dimensions;
      this.apiKey = config.apiKey;
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
    constructor(config: { model: string; baseUrl: string }) {
      this.model = config.model;
      this.baseUrl = config.baseUrl;
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
    it("returns OpenAIEmbeddings when provider is 'openai'", async () => {
      const config: EmbeddingConfig = {
        provider: "openai",
        modelName: "text-embedding-3-small",
        dimensions: 1536,
        apiKey: "test-api-key",
      };

      const { OpenAIEmbeddings } = await import("@langchain/openai");
      const result = await createEmbeddingsModel(config);

      expect(OpenAIEmbeddings).toHaveBeenCalledWith({
        model: "text-embedding-3-small",
        dimensions: 1536,
        apiKey: "test-api-key",
      });
      expect(result).toBeDefined();
    });

    it("uses process.env.OPENAI_API_KEY when apiKey not provided", async () => {
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "env-api-key";

      const config: EmbeddingConfig = {
        provider: "openai",
        modelName: "text-embedding-3-small",
        dimensions: 1536,
      };

      const { OpenAIEmbeddings } = await import("@langchain/openai");
      await createEmbeddingsModel(config);

      expect(OpenAIEmbeddings).toHaveBeenCalledWith({
        model: "text-embedding-3-small",
        dimensions: 1536,
        apiKey: "env-api-key",
      });

      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("returns OllamaEmbeddings when provider is 'ollama'", async () => {
      const config: EmbeddingConfig = {
        provider: "ollama",
        modelName: "nomic-embed-text",
        dimensions: 768,
        baseUrl: "http://localhost:11434",
      };

      const { OllamaEmbeddings } = await import("@langchain/ollama");
      const result = await createEmbeddingsModel(config);

      expect(OllamaEmbeddings).toHaveBeenCalledWith({
        model: "nomic-embed-text",
        baseUrl: "http://localhost:11434",
      });
      expect(result).toBeDefined();
    });

    it("uses default baseUrl for Ollama when not provided", async () => {
      const config: EmbeddingConfig = {
        provider: "ollama",
        modelName: "nomic-embed-text",
        dimensions: 768,
      };

      const { OllamaEmbeddings } = await import("@langchain/ollama");
      await createEmbeddingsModel(config);

      expect(OllamaEmbeddings).toHaveBeenCalledWith({
        model: "nomic-embed-text",
        baseUrl: "http://localhost:11434",
      });
    });

    it("passes correct config to OpenAIEmbeddings", async () => {
      const config: EmbeddingConfig = {
        provider: "openai",
        modelName: "text-embedding-ada-002",
        dimensions: 1536,
        apiKey: "custom-key",
      };

      const { OpenAIEmbeddings } = await import("@langchain/openai");
      await createEmbeddingsModel(config);

      expect(OpenAIEmbeddings).toHaveBeenCalledWith({
        model: "text-embedding-ada-002",
        dimensions: 1536,
        apiKey: "custom-key",
      });
    });

    it("passes correct config to OllamaEmbeddings", async () => {
      const config: EmbeddingConfig = {
        provider: "ollama",
        modelName: "all-minilm",
        dimensions: 384,
        baseUrl: "http://custom-host:8080",
      };

      const { OllamaEmbeddings } = await import("@langchain/ollama");
      await createEmbeddingsModel(config);

      expect(OllamaEmbeddings).toHaveBeenCalledWith({
        model: "all-minilm",
        baseUrl: "http://custom-host:8080",
      });
    });

    it("throws error for unsupported provider", async () => {
      const config = {
        provider: "unsupported" as any,
        modelName: "test-model",
        dimensions: 1536,
      };

      await expect(createEmbeddingsModel(config)).rejects.toThrow(
        "Unsupported embedding provider: unsupported"
      );
    });
  });
});
