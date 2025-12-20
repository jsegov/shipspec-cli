import { describe, it, expect, vi } from "vitest";
import { createResearcherNode } from "../../../../agents/productionalize/nodes/researcher.js";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";

describe("Researcher Node", () => {
  it("should generate a research digest", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ content: "mock research digest" });
    const mockModel = {
      invoke: mockInvoke,
    } as unknown as BaseChatModel;
    const mockWebSearchInvoke = vi.fn().mockResolvedValue("search results");
    const mockWebSearchTool = {
      invoke: mockWebSearchInvoke,
      name: "web_search",
      description: "search",
    } as unknown as DynamicStructuredTool;

    const node = createResearcherNode(mockModel, mockWebSearchTool);
    const state = {
      signals: {
        detectedLanguages: ["typescript"],
      },
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.researchDigest).toBe("mock research digest");
    expect(mockWebSearchInvoke).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalled();
  });
});
