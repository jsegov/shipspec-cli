import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAggregatorNode } from "../../../agents/nodes/aggregator.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentStateType } from "../../../agents/state.js";
import type { TokenBudget } from "../../../utils/tokens.js";

interface Message {
  content: string;
}

describe("AggregatorNode", () => {
  let mockModel: Partial<BaseChatModel>;
  let aggregatorNode: ReturnType<typeof createAggregatorNode>;

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
      invoke: vi.fn(),
    };
    
    aggregatorNode = createAggregatorNode(mockModel as BaseChatModel);
  });

  it("should synthesize final spec from completed subtasks", async () => {
    const mockSpec = {
      content: "# Technical Specification\n\n## Overview\n\nThis is the final spec.",
    };

    (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSpec);

    const state: AgentStateType = {
      userQuery: "Analyze the codebase",
      subtasks: [
        {
          id: "1",
          query: "How does auth work?",
          status: "complete",
          result: "Auth uses JWT tokens",
        },
        {
          id: "2",
          query: "What is the database schema?",
          status: "complete",
          result: "Schema has users and posts tables",
        },
        {
          id: "3",
          query: "Additional task",
          status: "complete",
          result: "Some other findings",
        },
      ],
      messages: [],
      context: [],
      finalSpec: undefined,
    };

    const result = await aggregatorNode(state);

    expect(mockModel.invoke).toHaveBeenCalled();
    expect(result.finalSpec).toBe(mockSpec.content);
    
    const systemContent = getInvokeContent(mockModel, 0);
    const humanContent = getInvokeContent(mockModel, 1);
    expect(systemContent).toContain("You are a technical writer");
    expect(humanContent).toContain("Analyze the codebase");
    expect(humanContent).toContain("How does auth work?");
    expect(humanContent).toContain("Auth uses JWT tokens");
    expect(humanContent).toContain("What is the database schema?");
    expect(humanContent).toContain("Schema has users and posts tables");
    expect(humanContent).toContain("Additional task");
  });

  it("should ignore subtasks without results", async () => {
    const mockSpec = { content: "Spec" };
    (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSpec);

    const state: AgentStateType = {
      userQuery: "Test",
      subtasks: [
        {
          id: "1",
          query: "Complete task",
          status: "complete",
          result: "Result 1",
        },
        {
          id: "2",
          query: "Task without result",
          status: "complete",
          result: undefined,
        },
      ],
      messages: [],
      context: [],
      finalSpec: undefined,
    };

    await aggregatorNode(state);

    const humanContent = getInvokeContent(mockModel, 1);
    expect(humanContent).toContain("Complete task");
    expect(humanContent).toContain("Result 1");
    expect(humanContent).not.toContain("Task without result");
  });

  it("should handle no complete subtasks", async () => {
    const mockSpec = { content: "No findings" };
    (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSpec);

    const state: AgentStateType = {
      userQuery: "Test query",
      subtasks: [],
      messages: [],
      context: [],
      finalSpec: undefined,
    };

    const result = await aggregatorNode(state);

    expect(result.finalSpec).toBe("No findings");
    const humanContent = getInvokeContent(mockModel, 1);
    expect(humanContent).toContain("Test query");
  });

  it("should format findings with markdown headers", async () => {
    const mockSpec = { content: "Spec" };
    (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSpec);

    const state: AgentStateType = {
      userQuery: "Query",
      subtasks: [
        {
          id: "1",
          query: "Question 1",
          status: "complete",
          result: "Answer 1",
        },
        {
          id: "2",
          query: "Question 2",
          status: "complete",
          result: "Answer 2",
        },
      ],
      messages: [],
      context: [],
      finalSpec: undefined,
    };

    await aggregatorNode(state);

    const humanContent = getInvokeContent(mockModel, 1);
    expect(humanContent).toContain("## Question 1");
    expect(humanContent).toContain("Answer 1");
    expect(humanContent).toContain("## Question 2");
    expect(humanContent).toContain("Answer 2");
    expect(humanContent).toContain("---");
  });

  describe("with token budget", () => {
    const tokenBudget: TokenBudget = {
      maxContextTokens: 500,
      reservedOutputTokens: 100,
    };

    beforeEach(() => {
      aggregatorNode = createAggregatorNode(mockModel as BaseChatModel, tokenBudget);
    });

    it("should truncate findings when exceeding token budget", async () => {
      const mockSpec = { content: "Truncated spec" };
      (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSpec);

      const state: AgentStateType = {
        userQuery: "Test query",
        subtasks: [
          {
            id: "1",
            query: "Large result 1",
            status: "complete",
            result: "a".repeat(2000), // ~500 tokens
          },
          {
            id: "2",
            query: "Large result 2",
            status: "complete",
            result: "b".repeat(2000), // ~500 tokens
          },
        ],
        messages: [],
        context: [],
        finalSpec: undefined,
      };

      await aggregatorNode(state);

      const humanContent = getInvokeContent(mockModel, 1);
      expect(humanContent).toContain("truncated");
    });

    it("should not truncate findings when within token budget", async () => {
      const mockSpec = { content: "Full spec" };
      (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSpec);

      const state: AgentStateType = {
        userQuery: "Test query",
        subtasks: [
          {
            id: "1",
            query: "Small result",
            status: "complete",
            result: "Short answer",
          },
        ],
        messages: [],
        context: [],
        finalSpec: undefined,
      };

      await aggregatorNode(state);

      const humanContent = getInvokeContent(mockModel, 1);
      expect(humanContent).not.toContain("truncated");
      expect(humanContent).toContain("Short answer");
    });
  });
});
