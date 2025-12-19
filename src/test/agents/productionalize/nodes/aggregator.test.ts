import { describe, it, expect, vi } from "vitest";
import { createAggregatorNode } from "../../../../agents/productionalize/nodes/aggregator.js";

describe("Aggregator Node", () => {
  it("should synthesize a final report", async () => {
    const mockModel = {
      invoke: vi.fn().mockResolvedValue({ content: "# Final Report" }),
    };

    const node = createAggregatorNode(mockModel as any);
    const state = {
      findings: [],
      signals: {},
      researchDigest: "test digest"
    } as any;

    const result = await node(state);

    expect(result.finalReport).toBe("# Final Report");
    expect(mockModel.invoke).toHaveBeenCalled();
  });
});
