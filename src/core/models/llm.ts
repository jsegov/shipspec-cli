import { initChatModel } from "langchain/chat_models/universal";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMConfig } from "../../config/schema.js";

export async function createChatModel(config: LLMConfig): Promise<BaseChatModel> {
  const model = await initChatModel(config.modelName, {
    modelProvider: config.provider,
    temperature: config.temperature,
    maxRetries: config.maxRetries,
    ...(config.timeout && { timeout: config.timeout }),
    ...(config.baseUrl && { baseUrl: config.baseUrl }),
    ...(config.apiKey && { apiKey: config.apiKey }),
  });

  return model;
}
