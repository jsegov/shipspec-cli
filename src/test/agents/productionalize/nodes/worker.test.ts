import { describe, it, expect, vi } from "vitest";
import { createWorkerNode } from "../../../../agents/productionalize/nodes/worker.js";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";
import type { ProductionalizeSubtask } from "../../../../agents/productionalize/types.js";

describe("Worker Node", () => {
  it("should analyze code and return findings", async () => {
    const mockOutput = {
      findings: [
        {
          id: "F1",
          severity: "high",
          category: "security",
          title: "Leak",
          description: "desc",
          evidence: {
            codeRefs: [{ filepath: "src/app.ts", lines: "1-10", content: "..." }],
            links: [],
          },
        },
      ],
      summary: "summary",
    };
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(mockOutput),
      }),
    } as unknown as BaseChatModel;
    const mockRetrieverTool = {
      invoke: vi
        .fn()
        .mockResolvedValue(JSON.stringify([{ filepath: "src/app.ts", content: "..." }])),
      name: "retrieve_code",
      description: "retrieve",
    } as unknown as DynamicStructuredTool;
    const mockWebSearchTool = {
      invoke: vi.fn().mockResolvedValue("search results"),
      name: "web_search",
      description: "search",
    } as unknown as DynamicStructuredTool;

    const node = createWorkerNode(mockModel, mockRetrieverTool, mockWebSearchTool);
    const subtask: ProductionalizeSubtask = {
      id: "1",
      category: "security",
      query: "audit auth",
      source: "code",
      status: "pending",
    };
    const state = {
      subtask,
      researchDigest: "test digest",
      sastResults: [],
      signals: {},
    } as unknown as ProductionalizeStateType & { subtask: ProductionalizeSubtask };

    const result = await node(state);

    const firstSubtask = result.subtasks[0];
    expect(firstSubtask).toBeDefined();
    expect(firstSubtask?.status).toBe("complete");
    expect(result.findings).toHaveLength(1);
    const firstFinding = result.findings[0];
    expect(firstFinding).toBeDefined();
    expect(firstFinding?.severity).toBe("high");
  });

  it("should proceed without interrupt when low confidence (parallel workers cannot use interrupt)", async () => {
    // Regression test: Workers run in parallel via Send(), so interrupt() breaks routing.
    // Low confidence findings should proceed with a warning, not interrupt.
    const mockOutput = {
      findings: [
        {
          id: "F1",
          severity: "medium",
          category: "security",
          title: "Potential issue",
          description: "Requires more context",
          evidence: { codeRefs: [], links: [] },
        },
      ],
      summary: "Low confidence summary",
      confidenceLevel: "low",
      clarificationQuestions: [
        "Is this a public-facing API?",
        "What authentication method is used?",
      ],
    };

    const mockInvoke = vi.fn().mockResolvedValue(mockOutput);
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({ invoke: mockInvoke }),
    } as unknown as BaseChatModel;

    const mockRetrieverTool = {
      invoke: vi.fn().mockResolvedValue(JSON.stringify([])),
      name: "retrieve_code",
      description: "retrieve",
    } as unknown as DynamicStructuredTool;

    const mockWebSearchTool = {
      invoke: vi.fn().mockResolvedValue("search results"),
      name: "web_search",
      description: "search",
    } as unknown as DynamicStructuredTool;

    const node = createWorkerNode(mockModel, mockRetrieverTool, mockWebSearchTool);
    const subtask: ProductionalizeSubtask = {
      id: "1",
      category: "security",
      query: "audit auth",
      source: "code",
      status: "pending",
    };
    const state = {
      subtask,
      researchDigest: "test digest",
      sastResults: [],
      signals: {},
      interactiveMode: true, // Even in interactive mode, workers should NOT interrupt
    } as unknown as ProductionalizeStateType & { subtask: ProductionalizeSubtask };

    // Should NOT throw or hang waiting for interrupt
    const result = await node(state);

    // Verify the model was only called once (no re-invocation after clarification)
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Verify findings are returned despite low confidence
    expect(result.findings).toHaveLength(1);
    expect(result.subtasks[0]?.status).toBe("complete");
    expect(result.subtasks[0]?.result).toBe("Low confidence summary");
  });
});
