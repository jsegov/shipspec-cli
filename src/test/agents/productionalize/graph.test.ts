import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProductionalizeGraph } from "../../../agents/productionalize/graph.js";
import { DocumentRepository } from "../../../core/storage/repository.js";
import type { ShipSpecConfig } from "../../../config/schema.js";
import { createSASTScannerTool } from "../../../agents/tools/sast-scanner.js";

vi.mock("../../../agents/tools/sast-scanner.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../agents/tools/sast-scanner.js")>();
  return {
    ...actual,
    createSASTScannerTool: vi.fn(),
  };
});

vi.mock("../../../core/models/llm.js", () => ({
  createChatModel: vi.fn().mockResolvedValue({
    invoke: vi.fn().mockResolvedValue({ content: "{}" }),
    withStructuredOutput: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ subtasks: [] }),
    }),
  }),
}));

describe("Productionalize Graph", () => {
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
      coreCategories: ["security"],
    },
  } as unknown as ShipSpecConfig;
  const mockRepository = {} as DocumentRepository;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should compile the graph", async () => {
    vi.mocked(createSASTScannerTool).mockReturnValue({
      invoke: vi.fn().mockResolvedValue(JSON.stringify({ findings: [] })),
    } as unknown as ReturnType<typeof createSASTScannerTool>);

    const graph = await createProductionalizeGraph(mockConfig, mockRepository);
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });

  it("should handle valid scanner output", async () => {
    const findings = [
      {
        tool: "semgrep",
        severity: "high",
        rule: "test-rule",
        message: "test-message",
        filepath: "test.ts",
      },
    ];
    const mockInvoke = vi.fn().mockResolvedValue(JSON.stringify({ findings }));
    const mockTool = {
      invoke: mockInvoke,
    };
    vi.mocked(createSASTScannerTool).mockReturnValue(
      mockTool as unknown as ReturnType<typeof createSASTScannerTool>
    );

    const graph = await createProductionalizeGraph(mockConfig, mockRepository);

    const result = await graph.invoke({
      userQuery: "test query",
      messages: [],
    });

    expect(mockInvoke).toHaveBeenCalled();
    expect(result.sastResults).toHaveLength(1);
    expect(result.sastResults[0]?.tool).toBe("semgrep");
  });

  it("should fail on malformed JSON from scanner", async () => {
    const mockTool = {
      invoke: vi.fn().mockResolvedValue("invalid json"),
    };
    vi.mocked(createSASTScannerTool).mockReturnValue(
      mockTool as unknown as ReturnType<typeof createSASTScannerTool>
    );

    const graph = await createProductionalizeGraph(mockConfig, mockRepository);

    await expect(
      graph.invoke({
        userQuery: "test query",
        messages: [],
      })
    ).rejects.toThrow("SAST scanning failed unexpectedly");
  });

  it("should fail on invalid schema from scanner", async () => {
    const mockTool = {
      invoke: vi.fn().mockResolvedValue(JSON.stringify({ findings: "not an array" })),
    };
    vi.mocked(createSASTScannerTool).mockReturnValue(
      mockTool as unknown as ReturnType<typeof createSASTScannerTool>
    );

    const graph = await createProductionalizeGraph(mockConfig, mockRepository);

    await expect(
      graph.invoke({
        userQuery: "test query",
        messages: [],
      })
    ).rejects.toThrow("Failed to validate scanner results schema");
  });

  it("should fail when scanner returns error findings", async () => {
    const findings = [
      {
        tool: "semgrep",
        severity: "high",
        rule: "scanner_error",
        message: "Failed to parse Semgrep output",
        filepath: "(scanner)",
      },
    ];
    const mockTool = {
      invoke: vi.fn().mockResolvedValue(JSON.stringify({ findings })),
    };
    vi.mocked(createSASTScannerTool).mockReturnValue(
      mockTool as unknown as ReturnType<typeof createSASTScannerTool>
    );

    const graph = await createProductionalizeGraph(mockConfig, mockRepository);

    await expect(
      graph.invoke({
        userQuery: "test query",
        messages: [],
      })
    ).rejects.toThrow("SAST scanner(s) failed: [semgrep] Failed to parse Semgrep output");
  });
});
