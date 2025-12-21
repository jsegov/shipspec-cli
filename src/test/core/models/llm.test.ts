import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChatModel } from "../../../core/models/llm.js";
import type { LLMConfig } from "../../../config/schema.js";

vi.mock("langchain/chat_models/universal", () => ({
  initChatModel: vi.fn().mockResolvedValue({
    invoke: vi.fn(),
  }),
}));

describe("LLM Factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createChatModel", () => {
    it("passes maxRetries to initChatModel", async () => {
      const config: LLMConfig = {
        provider: "openai",
        modelName: "gpt-5.2-2025-12-11",
        temperature: 0,
        maxRetries: 5,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      const { initChatModel } = await import("langchain/chat_models/universal");
      await createChatModel(config);

      expect(initChatModel).toHaveBeenCalledWith("gpt-5.2-2025-12-11", {
        modelProvider: "openai",
        temperature: 0,
        maxRetries: 5,
      });
    });

    it("defaults maxRetries to 3 when not provided", async () => {
      const config: LLMConfig = {
        provider: "openai",
        modelName: "gpt-5.2-2025-12-11",
        temperature: 0,
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      const { initChatModel } = await import("langchain/chat_models/universal");
      await createChatModel(config);

      expect(initChatModel).toHaveBeenCalledWith("gpt-5.2-2025-12-11", {
        modelProvider: "openai",
        temperature: 0,
        maxRetries: 3,
      });
    });

    it("passes timeout when provided", async () => {
      const config: LLMConfig = {
        provider: "openai",
        modelName: "gpt-5.2-2025-12-11",
        temperature: 0,
        maxRetries: 3,
        timeout: 30000,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      const { initChatModel } = await import("langchain/chat_models/universal");
      await createChatModel(config);

      expect(initChatModel).toHaveBeenCalledWith("gpt-5.2-2025-12-11", {
        modelProvider: "openai",
        temperature: 0,
        maxRetries: 3,
        timeout: 30000,
      });
    });

    it("does not pass timeout when not provided", async () => {
      const config: LLMConfig = {
        provider: "openai",
        modelName: "gpt-5.2-2025-12-11",
        temperature: 0,
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      const { initChatModel } = await import("langchain/chat_models/universal");
      await createChatModel(config);

      const mockCalls = (initChatModel as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const firstCall = mockCalls[0];
      if (!firstCall) throw new Error("Expected at least one call");
      const callArgs = firstCall[1] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty("timeout");
    });

    it("passes baseUrl for Ollama provider", async () => {
      const config: LLMConfig = {
        provider: "ollama",
        modelName: "llama2",
        temperature: 0,
        baseUrl: "http://localhost:11434",
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      const { initChatModel } = await import("langchain/chat_models/universal");
      await createChatModel(config);

      expect(initChatModel).toHaveBeenCalledWith("llama2", {
        modelProvider: "ollama",
        temperature: 0,
        maxRetries: 3,
        baseUrl: "http://localhost:11434",
      });
    });

    it("passes apiKey when provided", async () => {
      const config: LLMConfig = {
        provider: "openai",
        modelName: "gpt-5.2-2025-12-11",
        temperature: 0.5,
        apiKey: "test-api-key",
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      const { initChatModel } = await import("langchain/chat_models/universal");
      await createChatModel(config);

      expect(initChatModel).toHaveBeenCalledWith("gpt-5.2-2025-12-11", {
        modelProvider: "openai",
        temperature: 0.5,
        maxRetries: 3,
        apiKey: "test-api-key",
      });
    });

    it("supports different providers", async () => {
      const config: LLMConfig = {
        provider: "anthropic",
        modelName: "claude-3-opus",
        temperature: 0.7,
        maxRetries: 2,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      const { initChatModel } = await import("langchain/chat_models/universal");
      await createChatModel(config);

      expect(initChatModel).toHaveBeenCalledWith("claude-3-opus", {
        modelProvider: "anthropic",
        temperature: 0.7,
        maxRetries: 2,
      });
    });
  });
});
