import { describe, it, expect, vi } from "vitest";
import { createProductionalizeGraph } from "../../../agents/productionalize/graph.js";
import { DocumentRepository } from "../../../core/storage/repository.js";

describe("Productionalize Graph", () => {
  it("should compile the graph", async () => {
    const mockConfig = {
      projectPath: ".",
      llm: { provider: "openai" },
      embedding: { dimensions: 3072 },
      productionalize: {
        webSearch: { provider: "tavily" },
        sast: { enabled: true, tools: ["semgrep"] }
      }
    } as any;
    const mockRepository = {} as DocumentRepository;

    const graph = await createProductionalizeGraph(mockConfig, mockRepository);
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });
});
