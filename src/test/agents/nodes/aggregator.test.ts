import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAggregatorNode } from "../../../agents/nodes/aggregator.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AgentStateType } from "../../../agents/state.js";

describe("AggregatorNode", () => {
  let mockModel: Partial<BaseChatModel>;
  let aggregatorNode: ReturnType<typeof createAggregatorNode>;

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
    
    const invokeCall = (mockModel.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(invokeCall[0].content).toContain("Analyze the codebase");
    expect(invokeCall[0].content).toContain("How does auth work?");
    expect(invokeCall[0].content).toContain("Auth uses JWT tokens");
    expect(invokeCall[0].content).toContain("What is the database schema?");
    expect(invokeCall[0].content).toContain("Schema has users and posts tables");
    expect(invokeCall[0].content).toContain("Additional task");
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

    const invokeCall = (mockModel.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const content = invokeCall[0].content as string;
    expect(content).toContain("Complete task");
    expect(content).toContain("Result 1");
    expect(content).not.toContain("Task without result");
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
    const invokeCall = (mockModel.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(invokeCall[0].content).toContain("Test query");
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

    const invokeCall = (mockModel.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const content = invokeCall[0].content as string;
    expect(content).toContain("## Question 1");
    expect(content).toContain("Answer 1");
    expect(content).toContain("## Question 2");
    expect(content).toContain("Answer 2");
    expect(content).toContain("---");
  });
});
