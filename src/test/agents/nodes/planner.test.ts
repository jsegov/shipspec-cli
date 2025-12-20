import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPlannerNode } from "../../../agents/nodes/planner.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentStateType } from "../../../agents/state.js";

interface Message {
  content: string;
}

describe("PlannerNode", () => {
  let mockModel: Partial<BaseChatModel>;
  let plannerNode: ReturnType<typeof createPlannerNode>;

  const getInvokeContent = (mock: unknown, index = 0): string => {
    const mocked = vi.mocked(mock as { invoke: (messages: Message[]) => unknown });
    const calls = mocked.invoke.mock.calls;
    const firstCall = calls[0];
    if (!firstCall) return "";
    const firstArg = firstCall[0];
    return firstArg[index]?.content ?? "";
  };

  beforeEach(() => {
    mockModel = {
      withStructuredOutput: vi.fn(),
    };
  });

  it("should decompose query into subtasks", async () => {
    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue({
        reasoning: "Overall reasoning",
        subtasks: [
          { id: "1", query: "Analyze authentication flow", reasoning: "R1" },
          { id: "2", query: "Review database schema", reasoning: "R2" },
          { id: "3", query: "Check API endpoints", reasoning: "R3" },
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
    const [first, second, third] = result.subtasks;
    expect(first).toBeDefined();
    expect(first?.id).toBe("1");
    expect(first?.query).toBe("Analyze authentication flow");
    expect(first?.status).toBe("pending");
    expect(second?.status).toBe("pending");
    expect(third?.status).toBe("pending");
  });

  it("should include user query in prompt", async () => {
    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue({
        reasoning: "Overall reasoning",
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

    const systemContent = getInvokeContent(mockStructuredModel, 0);
    const humanContent = getInvokeContent(mockStructuredModel, 1);
    expect(systemContent).toContain("You are a senior software architect");
    expect(humanContent).toContain("Explain the codebase architecture");
  });

  it("should set all subtasks to pending status", async () => {
    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue({
        reasoning: "Overall reasoning",
        subtasks: [
          { id: "1", query: "Task 1", reasoning: "R1" },
          { id: "2", query: "Task 2", reasoning: "R2" },
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
