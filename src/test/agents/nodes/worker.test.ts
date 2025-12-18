import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkerNode } from "../../../agents/nodes/worker.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Subtask, AgentStateType } from "../../../agents/state.js";
import type { TokenBudget } from "../../../utils/tokens.js";

describe("WorkerNode", () => {
  let mockModel: Partial<BaseChatModel>;
  let mockRetrieverTool: Partial<DynamicStructuredTool>;
  let workerNode: ReturnType<typeof createWorkerNode>;

  beforeEach(() => {
    mockModel = {
      invoke: vi.fn(),
    };

    mockRetrieverTool = {
      invoke: vi.fn(),
    };

    workerNode = createWorkerNode(
      mockModel as BaseChatModel,
      mockRetrieverTool as DynamicStructuredTool
    );
  });

  const createMockState = (subtask: Subtask): AgentStateType & { subtask: Subtask } => ({
    userQuery: "test",
    subtasks: [subtask],
    messages: [],
    context: [],
    finalSpec: undefined,
    subtask,
  });

  it("should process subtask with retrieval and summarization", async () => {
    const subtask: Subtask = {
      id: "1",
      query: "How does authentication work?",
      status: "pending",
    };

    const mockToolResult = JSON.stringify([
      {
        filepath: "auth.ts",
        content: "function authenticate() {}",
        type: "function",
        symbolName: "authenticate",
        lines: "1-10",
      },
    ]);

    const mockSummary = {
      content: "Authentication is handled by the authenticate function",
    };

    (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockToolResult);
    (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSummary);

    const input = createMockState(subtask);
    const result = await workerNode(input);

    expect(mockRetrieverTool.invoke).toHaveBeenCalledWith({
      query: "How does authentication work?",
      k: 10,
    });
    expect(mockModel.invoke).toHaveBeenCalled();
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0].id).toBe("1");
    expect(result.subtasks[0].status).toBe("complete");
    expect(result.subtasks[0].result).toBe("Authentication is handled by the authenticate function");
  });

  it("should include tool result in summary prompt", async () => {
    const subtask: Subtask = {
      id: "2",
      query: "What is the database schema?",
      status: "pending",
    };

    const mockToolResult = JSON.stringify([{ filepath: "schema.ts", content: "export const schema = {}" }]);
    const mockSummary = { content: "Summary" };

    (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockToolResult);
    (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockSummary);

    const input = createMockState(subtask);
    await workerNode(input);

    const invokeCall = (mockModel.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(invokeCall[0].content).toContain("What is the database schema?");
    expect(invokeCall[0].content).toContain(mockToolResult);
  });

  it("should mark subtask as complete with result", async () => {
    const subtask: Subtask = {
      id: "3",
      query: "Test query",
      status: "pending",
    };

    (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue("[]");
    (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "Test summary",
    });

    const input = createMockState(subtask);
    const result = await workerNode(input);

    expect(result.subtasks[0].status).toBe("complete");
    expect(result.subtasks[0].result).toBe("Test summary");
    expect(result.subtasks[0].id).toBe(subtask.id);
    expect(result.subtasks[0].query).toBe(subtask.query);
  });

  describe("with token budget", () => {
    const tokenBudget: TokenBudget = {
      maxContextTokens: 1000,
      reservedOutputTokens: 200,
    };

    beforeEach(() => {
      workerNode = createWorkerNode(
        mockModel as BaseChatModel,
        mockRetrieverTool as DynamicStructuredTool,
        tokenBudget
      );
    });

    it("should prune chunks when exceeding token budget", async () => {
      const subtask: Subtask = {
        id: "4",
        query: "Test with budget",
        status: "pending",
      };

      // Create chunks that exceed budget
      // Budget available: (1000 - 200) * 0.7 = 560 tokens
      // Each chunk with 800 chars = ~200 tokens, so only ~2-3 should fit
      const mockChunks = [
        { id: "1", content: "a".repeat(800), filepath: "a.ts", startLine: 1, endLine: 10, language: "typescript", type: "function" },
        { id: "2", content: "b".repeat(800), filepath: "b.ts", startLine: 1, endLine: 10, language: "typescript", type: "function" },
        { id: "3", content: "c".repeat(800), filepath: "c.ts", startLine: 1, endLine: 10, language: "typescript", type: "function" },
        { id: "4", content: "d".repeat(800), filepath: "d.ts", startLine: 1, endLine: 10, language: "typescript", type: "function" },
      ];

      (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(mockChunks));
      (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "Summary" });

      const input = createMockState(subtask);
      await workerNode(input);

      const invokeCall = (mockModel.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const contextInPrompt = invokeCall[0].content;

      // The context should have pruned some chunks
      // Parse the JSON from the prompt to verify pruning
      const jsonMatch = contextInPrompt.match(/\[.*\]/s);
      if (jsonMatch) {
        const parsedChunks = JSON.parse(jsonMatch[0]);
        expect(parsedChunks.length).toBeLessThan(mockChunks.length);
      }
    });

    it("should handle invalid JSON gracefully", async () => {
      const subtask: Subtask = {
        id: "5",
        query: "Test with invalid JSON",
        status: "pending",
      };

      (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue("not valid json");
      (mockModel.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "Summary" });

      const input = createMockState(subtask);
      const result = await workerNode(input);

      // Should still complete successfully, using original result
      expect(result.subtasks[0].status).toBe("complete");
      expect(result.subtasks[0].result).toBe("Summary");
    });
  });
});
