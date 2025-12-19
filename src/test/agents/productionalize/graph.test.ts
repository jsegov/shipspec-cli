import { describe, it, expect } from "vitest";
import { createProductionalizeGraph } from "../../../agents/productionalize/graph.js";
import { DocumentRepository } from "../../../core/storage/repository.js";
import type { ShipSpecConfig } from "../../../config/schema.js";

describe("Productionalize Graph", () => {
  it("should compile the graph", async () => {
    const mockConfig = {
      projectPath: ".",
      vectorDbPath: ".ship-spec/lancedb",
      ignorePatterns: [],
      llm: { provider: "openai", modelName: "gpt-4", temperature: 0 },
      embedding: { provider: "openai", modelName: "text-embedding", dimensions: 3072 },
      checkpoint: { enabled: false, type: "memory" },
      productionalize: {
        webSearch: { provider: "tavily" },
        sast: { enabled: true, tools: ["semgrep"] },
        coreCategories: ["security"]
      }
    } as unknown as ShipSpecConfig;
    const mockRepository = {} as DocumentRepository;

    const graph = await createProductionalizeGraph(mockConfig, mockRepository);
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });
});
