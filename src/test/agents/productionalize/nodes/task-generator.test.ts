import { describe, it, expect, vi } from "vitest";
import { createTaskGeneratorNode } from "../../../../agents/productionalize/nodes/task-generator.js";

describe("Task Generator Node", () => {
  it("should generate a list of tasks", async () => {
    const mockOutput = {
      tasks: [
        { id: 1, title: "Fix vulnerability", description: "desc", status: "pending", priority: "high", dependencies: [], details: "steps", testStrategy: "verify" }
      ]
    };
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(mockOutput)
      })
    };

    const node = createTaskGeneratorNode(mockModel as any);
    const state = {
      findings: [],
      signals: {}
    } as any;

    const result = await node(state);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe(1);
    expect(result.tasks[0].priority).toBe("high");
  });
});
