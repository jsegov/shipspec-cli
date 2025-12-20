import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkerNode } from "../../../agents/nodes/worker.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Subtask, AgentStateType } from "../../../agents/state.js";
import type { TokenBudget } from "../../../utils/tokens.js";

interface Message {
  content: string;
}

describe("WorkerNode", () => {
  let mockModel: Partial<BaseChatModel>;
  let mockRetrieverTool: Partial<DynamicStructuredTool>;
  let workerNode: ReturnType<typeof createWorkerNode>;

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

    mockRetrieverTool = {
      invoke: vi.fn(),
    };
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

    const mockOutput = {
      summary: "Authentication is handled by the authenticate function",
      reasoning: "Reasoning",
      findings: [],
      confidenceLevel: "high",
    };

    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue(mockOutput),
    };

    (mockModel.withStructuredOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockStructuredModel);
    (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockToolResult);

    workerNode = createWorkerNode(
      mockModel as BaseChatModel,
      mockRetrieverTool as DynamicStructuredTool
    );

    const input = createMockState(subtask);
    const result = await workerNode(input);

    expect(mockRetrieverTool.invoke).toHaveBeenCalledWith({
      query: "How does authentication work?",
      k: 10,
    });
    expect(mockStructuredModel.invoke).toHaveBeenCalled();
    expect(result.subtasks).toHaveLength(1);
    const resultSubtask = result.subtasks[0];
    expect(resultSubtask).toBeDefined();
    expect(resultSubtask?.id).toBe("1");
    expect(resultSubtask?.status).toBe("complete");
    expect(resultSubtask?.result).toBe("Authentication is handled by the authenticate function");
  });

  it("should include tool result in summary prompt", async () => {
    const subtask: Subtask = {
      id: "2",
      query: "What is the database schema?",
      status: "pending",
    };

    const mockToolResult = JSON.stringify([{ filepath: "schema.ts", content: "export const schema = {}" }]);
    const mockOutput = { summary: "Summary", reasoning: "Reasoning", findings: [], confidenceLevel: "high" };

    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue(mockOutput),
    };

    (mockModel.withStructuredOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockStructuredModel);
    (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(mockToolResult);

    workerNode = createWorkerNode(
      mockModel as BaseChatModel,
      mockRetrieverTool as DynamicStructuredTool
    );

    const input = createMockState(subtask);
    await workerNode(input);

    const humanContent = getInvokeContent(mockStructuredModel, 1);
    expect(humanContent).toContain("What is the database schema?");
    expect(humanContent).toContain(mockToolResult);
  });

  it("should mark subtask as complete with result", async () => {
    const subtask: Subtask = {
      id: "3",
      query: "Test query",
      status: "pending",
    };

    const mockOutput = {
      summary: "Test summary",
      reasoning: "Reasoning",
      findings: [],
      confidenceLevel: "high",
    };

    const mockStructuredModel = {
      invoke: vi.fn().mockResolvedValue(mockOutput),
    };

    (mockModel.withStructuredOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockStructuredModel);
    (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue("[]");

    workerNode = createWorkerNode(
      mockModel as BaseChatModel,
      mockRetrieverTool as DynamicStructuredTool
    );

    const input = createMockState(subtask);
    const result = await workerNode(input);

    const resultSubtask = result.subtasks[0];
    expect(resultSubtask).toBeDefined();
    expect(resultSubtask?.status).toBe("complete");
    expect(resultSubtask?.result).toBe("Test summary");
    expect(resultSubtask?.id).toBe(subtask.id);
    expect(resultSubtask?.query).toBe(subtask.query);
  });

  describe("with token budget", () => {
    const tokenBudget: TokenBudget = {
      maxContextTokens: 1000,
      reservedOutputTokens: 200,
    };

    it("should prune chunks when exceeding token budget", async () => {
      const subtask: Subtask = {
        id: "4",
        query: "Test with budget",
        status: "pending",
      };

      const mockChunks = [
        { id: "1", content: "a".repeat(800), filepath: "a.ts", startLine: 1, endLine: 10, language: "typescript", type: "function" },
        { id: "2", content: "b".repeat(800), filepath: "b.ts", startLine: 1, endLine: 10, language: "typescript", type: "function" },
        { id: "3", content: "c".repeat(800), filepath: "c.ts", startLine: 1, endLine: 10, language: "typescript", type: "function" },
        { id: "4", content: "d".repeat(800), filepath: "d.ts", startLine: 1, endLine: 10, language: "typescript", type: "function" },
      ];

      const mockOutput = { summary: "Summary", reasoning: "Reasoning", findings: [], confidenceLevel: "high" };
      const mockStructuredModel = {
        invoke: vi.fn().mockResolvedValue(mockOutput),
      };

      (mockModel.withStructuredOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockStructuredModel);
      (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(mockChunks));

      workerNode = createWorkerNode(
        mockModel as BaseChatModel,
        mockRetrieverTool as DynamicStructuredTool,
        tokenBudget
      );

      const input = createMockState(subtask);
      await workerNode(input);

      const contextInPrompt = getInvokeContent(mockStructuredModel, 1);

      const jsonMatch = /\[.*\]/s.exec(contextInPrompt);
      if (jsonMatch) {
        const parsedChunks = JSON.parse(jsonMatch[0]) as unknown[];
        expect(parsedChunks.length).toBeLessThan(mockChunks.length);
      }
    });

    it("should handle invalid JSON gracefully", async () => {
      const subtask: Subtask = {
        id: "5",
        query: "Test with invalid JSON",
        status: "pending",
      };

      const mockOutput = { summary: "Summary", reasoning: "Reasoning", findings: [], confidenceLevel: "high" };
      const mockStructuredModel = {
        invoke: vi.fn().mockResolvedValue(mockOutput),
      };

      (mockModel.withStructuredOutput as ReturnType<typeof vi.fn>).mockReturnValue(mockStructuredModel);
      (mockRetrieverTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue("not valid json");

      workerNode = createWorkerNode(
        mockModel as BaseChatModel,
        mockRetrieverTool as DynamicStructuredTool,
        tokenBudget
      );

      const input = createMockState(subtask);
      const result = await workerNode(input);

      const resultSubtask = result.subtasks[0];
      expect(resultSubtask).toBeDefined();
      expect(resultSubtask?.status).toBe("complete");
      expect(resultSubtask?.result).toBe("Summary");
    });
  });
});
