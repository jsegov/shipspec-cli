/**
 * Tests for planning graph assembly and workflow.
 */

import { describe, it, expect } from "vitest";
import { createPlanningGraph } from "../../agents/planning/graph.js";
import type { ShipSpecConfig } from "../../config/schema.js";

describe("createPlanningGraph", () => {
  const mockConfig: ShipSpecConfig = {
    projectPath: "/test/project",
    vectorDbPath: "/test/lancedb",
    ignorePatterns: [],
    llm: {
      provider: "ollama",
      modelName: "llama2",
      temperature: 0,
      maxRetries: 3,
      maxContextTokens: 16000,
      reservedOutputTokens: 4000,
    },
    embedding: {
      provider: "ollama",
      modelName: "nomic-embed-text",
      dimensions: 768,
      maxRetries: 3,
    },
    checkpoint: {
      enabled: false,
      type: "memory",
    },
    productionalize: {
      coreCategories: ["security", "testing"],
      webSearch: {
        provider: "duckduckgo",
      },
    },
  };

  it("should create a planning graph without repository", async () => {
    const graph = await createPlanningGraph(mockConfig, null);
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });

  it("should create a planning graph with checkpointer", async () => {
    const graph = await createPlanningGraph(mockConfig, null, {
      checkpointer: undefined, // Would normally be a real checkpointer
    });
    expect(graph).toBeDefined();
  });
});
