import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorkerNode, type WorkerInput } from "../../../agents/nodes/worker.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Subtask } from "../../../agents/state.js";

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

    const input: WorkerInput = { subtask };
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

    const input: WorkerInput = { subtask };
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

    const input: WorkerInput = { subtask };
    const result = await workerNode(input);

    expect(result.subtasks[0].status).toBe("complete");
    expect(result.subtasks[0].result).toBe("Test summary");
    expect(result.subtasks[0].id).toBe(subtask.id);
    expect(result.subtasks[0].query).toBe(subtask.query);
  });
});
