import { describe, it, expect, vi } from "vitest";
import { createAggregatorNode } from "../../../../agents/productionalize/nodes/aggregator.js";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";

describe("Aggregator Node", () => {
  it("should synthesize a final report", async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: "# Final Report" }),
    } as unknown as BaseChatModel;

    const node = createAggregatorNode(mockModel);
    const state = {
      findings: [],
      signals: {},
      researchDigest: "test digest"
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.finalReport).toBe("# Final Report");
    expect(mockModel.invoke).toHaveBeenCalled();
  });
});
