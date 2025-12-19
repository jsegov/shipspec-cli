import { describe, it, expect, vi } from "vitest";
import { createWorkerNode } from "../../../../agents/productionalize/nodes/worker.js";

describe("Worker Node", () => {
  it("should analyze code and return findings", async () => {
    const mockOutput = {
      findings: [
        { id: "F1", severity: "high", category: "security", title: "Leak", description: "desc", evidence: { codeRefs: [] } }
      ],
      summary: "summary"
    };
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(mockOutput)
      })
    };
    const mockRetrieverTool = {
      invoke: vi.fn().mockResolvedValue(JSON.stringify([{ filepath: "src/app.ts", content: "..." }])),
      name: "retrieve_code",
      description: "retrieve"
    };
    const mockWebSearchTool = {
      invoke: vi.fn().mockResolvedValue("search results"),
      name: "web_search",
      description: "search"
    };

    const node = createWorkerNode(mockModel as any, mockRetrieverTool as any, mockWebSearchTool as any);
    const state = {
      subtask: { id: "1", category: "security", query: "audit auth", source: "code", status: "pending" },
      researchDigest: "test digest",
      sastResults: [],
      signals: {}
    } as any;

    const result = await node(state);

    expect(result.subtasks[0].status).toBe("complete");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("high");
  });
});
