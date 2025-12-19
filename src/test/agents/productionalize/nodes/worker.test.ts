import { describe, it, expect, vi } from "vitest";
import { createWorkerNode } from "../../../../agents/productionalize/nodes/worker.js";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";

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
            links: []
          } 
        }
      ],
      summary: "summary"
    };
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(mockOutput)
      })
    } as unknown as BaseChatModel;
    const mockRetrieverTool = {
      invoke: vi.fn().mockResolvedValue(JSON.stringify([{ filepath: "src/app.ts", content: "..." }])),
      name: "retrieve_code",
      description: "retrieve"
    } as unknown as DynamicStructuredTool;
    const mockWebSearchTool = {
      invoke: vi.fn().mockResolvedValue("search results"),
      name: "web_search",
      description: "search"
    } as unknown as DynamicStructuredTool;

    const node = createWorkerNode(mockModel, mockRetrieverTool, mockWebSearchTool);
    const state = {
      subtask: { id: "1", category: "security", query: "audit auth", source: "code", status: "pending" },
      researchDigest: "test digest",
      sastResults: [],
      signals: {}
    } as unknown as ProductionalizeStateType & { subtask: any };

    const result = await node(state);

    expect(result.subtasks[0].status).toBe("complete");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("high");
  });
});
