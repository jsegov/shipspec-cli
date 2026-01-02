import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMConfig } from "../../config/schema.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function createChatModel(config: LLMConfig, apiKey?: string): Promise<BaseChatModel> {
  switch (config.provider) {
    case "openrouter":
      // Don't set maxTokens for OpenRouter - let each model use its native limits.
      // reservedOutputTokens is for context budget planning only, not API limits.
      return Promise.resolve(
        new ChatOpenAI({
          model: config.modelName,
          temperature: config.temperature,
          maxRetries: config.maxRetries,
          ...(config.timeout && { timeout: config.timeout }),
          apiKey: apiKey ?? config.apiKey ?? process.env.OPENROUTER_API_KEY,
          configuration: {
            baseURL: OPENROUTER_BASE_URL,
          },
        })
      );
    case "ollama":
      return Promise.resolve(
        new ChatOllama({
          model: config.modelName,
          temperature: config.temperature,
          baseUrl: config.baseUrl ?? "http://localhost:11434",
          maxRetries: config.maxRetries,
          // ChatOllama doesn't have a native timeout parameter, so we implement it via custom fetch
          ...(config.timeout && {
            fetch: (input: string | URL | Request, init?: RequestInit) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => {
                controller.abort();
              }, config.timeout);

              const signals = [controller.signal];
              if (init?.signal) {
                signals.push(init.signal);
              }

              return fetch(input, {
                ...init,
                signal: AbortSignal.any(signals),
              }).finally(() => {
                clearTimeout(timeoutId);
              });
            },
          }),
        })
      );
    default: {
      const exhaustiveCheck: never = config.provider;
      return Promise.reject(new Error(`Unsupported LLM provider: ${String(exhaustiveCheck)}`));
    }
  }
}
