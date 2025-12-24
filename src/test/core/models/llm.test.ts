import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChatModel } from "../../../core/models/llm.js";
import type { LLMConfig } from "../../../config/schema.js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";

vi.mock("@langchain/openai", () => {
  const ChatOpenAI = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    config: Record<string, unknown>
  ) {
    Object.assign(this, config);
    this.invoke = vi.fn();
    return this;
  });
  return { ChatOpenAI };
});

vi.mock("@langchain/ollama", () => {
  const ChatOllama = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    config: Record<string, unknown>
  ) {
    Object.assign(this, config);
    this.invoke = vi.fn();
    return this;
  });
  return { ChatOllama };
});

describe("LLM Factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createChatModel", () => {
    it("passes maxRetries to ChatOpenAI via openrouter provider", async () => {
      const config: LLMConfig = {
        provider: "openrouter",
        modelName: "google/gemini-3-flash-preview",
        temperature: 0,
        maxRetries: 5,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      await createChatModel(config);

      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "google/gemini-3-flash-preview",
          temperature: 0,
          maxRetries: 5,
          configuration: {
            baseURL: "https://openrouter.ai/api/v1",
          },
        })
      );
    });

    it("defaults maxRetries to 3 when not provided", async () => {
      const config: LLMConfig = {
        provider: "openrouter",
        modelName: "google/gemini-3-flash-preview",
        temperature: 0,
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      await createChatModel(config);

      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 3,
        })
      );
    });

    it("passes timeout when provided", async () => {
      const config: LLMConfig = {
        provider: "openrouter",
        modelName: "google/gemini-3-flash-preview",
        temperature: 0,
        maxRetries: 3,
        timeout: 30000,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      await createChatModel(config);

      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
        })
      );
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

      await createChatModel(config);

      expect(ChatOllama).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "llama2",
          temperature: 0,
          baseUrl: "http://localhost:11434",
          maxRetries: 3,
        })
      );
    });

    it("passes apiKey when provided", async () => {
      const config: LLMConfig = {
        provider: "openrouter",
        modelName: "google/gemini-3-flash-preview",
        temperature: 0.5,
        apiKey: "test-api-key",
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      await createChatModel(config);

      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "test-api-key",
        })
      );
    });

    describe("ChatOllama custom fetch signal handling", () => {
      const originalFetch = global.fetch;

      beforeEach(() => {
        vi.clearAllMocks();
      });

      afterEach(() => {
        global.fetch = originalFetch;
        vi.useRealTimers();
      });

      it("should preserve existing signal when timeout is added", async () => {
        const config: LLMConfig = {
          provider: "ollama",
          modelName: "llama2",
          temperature: 0,
          baseUrl: "http://localhost:11434",
          maxRetries: 3,
          timeout: 1000,
          maxContextTokens: 16000,
          reservedOutputTokens: 4000,
        };

        const model = (await createChatModel(config)) as ChatOllama & {
          fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
        };
        const customFetch = model.fetch;

        expect(customFetch).toBeDefined();

        const externalController = new AbortController();
        const externalSignal = externalController.signal;

        let capturedSignal: AbortSignal | undefined | null;
        global.fetch = vi.fn().mockImplementation((_input: unknown, init: RequestInit) => {
          capturedSignal = init.signal;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
          });
        });

        await customFetch("http://localhost:11434/api/chat", {
          method: "POST",
          signal: externalSignal,
        });

        expect(capturedSignal).toBeDefined();
        externalController.abort();
        expect(capturedSignal?.aborted).toBe(true);
      });

      it("should abort fetch when timeout is reached", async () => {
        vi.useFakeTimers();
        const config: LLMConfig = {
          provider: "ollama",
          modelName: "llama2",
          temperature: 0,
          baseUrl: "http://localhost:11434",
          maxRetries: 3,
          timeout: 1000,
          maxContextTokens: 16000,
          reservedOutputTokens: 4000,
        };

        const model = (await createChatModel(config)) as ChatOllama & {
          fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
        };
        const customFetch = model.fetch;

        let capturedSignal: AbortSignal | undefined | null;
        global.fetch = vi.fn().mockImplementation((_input: unknown, init: RequestInit) => {
          capturedSignal = init.signal;
          return new Promise((resolve) => {
            // No-op to allow timeout
            void resolve;
          });
        });

        void customFetch("http://localhost:11434/api/chat", {
          method: "POST",
        });

        expect(capturedSignal).toBeDefined();
        expect(capturedSignal?.aborted).toBe(false);

        vi.advanceTimersByTime(1001);

        expect(capturedSignal?.aborted).toBe(true);
      });
    });
  });
});
