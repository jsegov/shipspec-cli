import { describe, it, expect, vi } from "vitest";
import { createResearcherNode } from "../../../../agents/productionalize/nodes/researcher.js";
import { HumanMessage } from "@langchain/core/messages";

describe("Researcher Node", () => {
  it("should generate a research digest", async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: "mock research digest" }),
    };
    const mockWebSearchTool = {
      invoke: vi.fn().mockResolvedValue("search results"),
      name: "web_search",
      description: "search",
    };

    const node = createResearcherNode(mockModel as any, mockWebSearchTool as any);
    const state = {
      signals: {
        detectedLanguages: ["typescript"],
      },
    } as any;

    const result = await node(state);

    expect(result.researchDigest).toBe("mock research digest");
    expect(mockWebSearchTool.invoke).toHaveBeenCalled();
    expect(mockModel.invoke).toHaveBeenCalled();
  });
});
