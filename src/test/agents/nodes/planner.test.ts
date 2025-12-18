import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPlannerNode } from "../../../agents/nodes/planner.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentStateType } from "../../../agents/state.js";

describe("PlannerNode", () => {
  let mockModel: Partial<BaseChatModel>;
  let plannerNode: ReturnType<typeof createPlannerNode>;

  beforeEach(() => {
    mockModel = {
      withStructuredOutput: vi.fn(),
    };
  });

  it("should decompose query into subtasks", async () => {
    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue({
        subtasks: [
          { id: "1", query: "Analyze authentication flow" },
          { id: "2", query: "Review database schema" },
          { id: "3", query: "Check API endpoints" },
        ],
      }),
    };

    (mockModel.withStructuredOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockStructuredModel);
    plannerNode = createPlannerNode(mockModel as BaseChatModel);

    const state: AgentStateType = {
      userQuery: "How does authentication work?",
      subtasks: [],
      messages: [],
      context: [],
      finalSpec: undefined,
    };

    const result = await plannerNode(state);

    expect(mockModel.withStructuredOutput).toHaveBeenCalled();
    expect(mockStructuredModel.invoke).toHaveBeenCalled();
    expect(result.subtasks).toHaveLength(3);
    expect(result.subtasks[0].id).toBe("1");
    expect(result.subtasks[0].query).toBe("Analyze authentication flow");
    expect(result.subtasks[0].status).toBe("pending");
    expect(result.subtasks[1].status).toBe("pending");
    expect(result.subtasks[2].status).toBe("pending");
  });

  it("should include user query in prompt", async () => {
    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue({
        subtasks: [],
      }),
    };

    (mockModel.withStructuredOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockStructuredModel);
    plannerNode = createPlannerNode(mockModel as BaseChatModel);

    const state: AgentStateType = {
      userQuery: "Explain the codebase architecture",
      subtasks: [],
      messages: [],
      context: [],
      finalSpec: undefined,
    };

    await plannerNode(state);

    const invokeCall = mockStructuredModel.invoke.mock.calls[0][0];
    expect(invokeCall[0].content).toContain("Explain the codebase architecture");
    expect(invokeCall[0].content).toContain("Decompose this request");
  });

  it("should set all subtasks to pending status", async () => {
    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue({
        subtasks: [
          { id: "1", query: "Task 1" },
          { id: "2", query: "Task 2" },
        ],
      }),
    };

    (mockModel.withStructuredOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockStructuredModel);
    plannerNode = createPlannerNode(mockModel as BaseChatModel);

    const state: AgentStateType = {
      userQuery: "Test query",
      subtasks: [],
      messages: [],
      context: [],
      finalSpec: undefined,
    };

    const result = await plannerNode(state);

    result.subtasks.forEach((subtask) => {
      expect(subtask.status).toBe("pending");
    });
  });
});
