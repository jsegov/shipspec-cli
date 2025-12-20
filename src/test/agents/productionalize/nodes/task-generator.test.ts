import { describe, it, expect, vi } from "vitest";
import { createTaskGeneratorNode } from "../../../../agents/productionalize/nodes/task-generator.js";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";

describe("Task Generator Node", () => {
  it("should generate a list of tasks", async () => {
    const mockOutput = {
      tasks: [
        { 
          id: 1, 
          title: "Fix vulnerability", 
          description: "desc", 
          status: "pending", 
          priority: "high", 
          dependencies: [], 
          details: "steps", 
          testStrategy: "verify",
          subtasks: []
        }
      ]
    };
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(mockOutput)
      })
    } as unknown as BaseChatModel;

    const node = createTaskGeneratorNode(mockModel);
    const state = {
      findings: [],
      signals: {}
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.tasks).toHaveLength(1);
    const firstTask = result.tasks[0];
    expect(firstTask).toBeDefined();
    expect(firstTask?.id).toBe(1);
    expect(firstTask?.priority).toBe("high");
  });
});
