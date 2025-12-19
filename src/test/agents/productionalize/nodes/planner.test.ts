import { describe, it, expect, vi } from "vitest";
import { createPlannerNode } from "../../../../agents/productionalize/nodes/planner.js";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";

describe("Planner Node", () => {
  it("should generate analysis subtasks", async () => {
    const mockPlan = {
      subtasks: [
        { id: "1", category: "security", query: "audit auth", source: "code", rationale: "test" }
      ]
    };
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(mockPlan)
      })
    } as unknown as BaseChatModel;

    const node = createPlannerNode(mockModel);
    const state = {
      userQuery: "test query",
      signals: {},
      researchDigest: "test digest",
      sastResults: []
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0].status).toBe("pending");
    expect(result.subtasks[0].category).toBe("security");
  });
});
