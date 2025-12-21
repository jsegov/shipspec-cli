import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRetrieverTool } from "../../../agents/tools/retriever.js";
import { DocumentRepository } from "../../../core/storage/repository.js";
import { CodeChunk } from "../../../core/types/index.js";

interface ParsedChunk {
  filepath: string;
  content: string;
  type: string;
  symbolName: string | null;
  lines: string;
}

describe("createRetrieverTool", () => {
  let mockRepository: Partial<DocumentRepository>;
  let retrieverTool: ReturnType<typeof createRetrieverTool>;

  beforeEach(() => {
    mockRepository = {
      hybridSearch: vi.fn(),
    };

    retrieverTool = createRetrieverTool(mockRepository as DocumentRepository);
  });

  it("should create a tool with correct name and description", () => {
    expect(retrieverTool.name).toBe("retrieve_code");
    expect(retrieverTool.description).toContain("codebase");
  });

  it("should have correct schema", () => {
    const schema = retrieverTool.schema;
    expect(schema.shape.query).toBeDefined();
    expect(schema.shape.k).toBeDefined();
  });

  it("should invoke repository hybridSearch with query and k", async () => {
    const mockChunks: CodeChunk[] = [
      {
        id: "1",
        content: "function test() {}",
        filepath: "test.ts",
        startLine: 1,
        endLine: 5,
        language: "typescript",
        type: "function",
        symbolName: "test",
      },
    ];

    (mockRepository.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue(mockChunks);

    const result = await retrieverTool.invoke({
      query: "test function",
      k: 5,
    });

    expect(mockRepository.hybridSearch).toHaveBeenCalledWith("test function", 5);
    expect(result).toBeDefined();
    const parsed = JSON.parse(result) as ParsedChunk[];
    expect(parsed).toHaveLength(1);
    const firstChunk = parsed[0];
    expect(firstChunk?.filepath).toBe("test.ts");
    expect(firstChunk?.symbolName).toBe("test");
    expect(firstChunk?.lines).toBe("1-5");
  });

  it("should use default k value when not provided", async () => {
    const mockChunks: CodeChunk[] = [];
    (mockRepository.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue(mockChunks);

    await retrieverTool.invoke({
      query: "test",
    });

    expect(mockRepository.hybridSearch).toHaveBeenCalledWith("test", 10);
  });

  it("should format chunks correctly", async () => {
    const mockChunks: CodeChunk[] = [
      {
        id: "1",
        content: "code1",
        filepath: "file1.ts",
        startLine: 10,
        endLine: 20,
        language: "typescript",
        type: "function",
        symbolName: "func1",
      },
      {
        id: "2",
        content: "code2",
        filepath: "file2.ts",
        startLine: 5,
        endLine: 15,
        language: "typescript",
        type: "class",
      },
    ];

    (mockRepository.hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue(mockChunks);

    const result = await retrieverTool.invoke({
      query: "test",
      k: 2,
    });

    const parsed = JSON.parse(result) as ParsedChunk[];
    expect(parsed).toHaveLength(2);
    const [first, second] = parsed;
    expect(first).toEqual({
      filepath: "file1.ts",
      content: "code1",
      type: "function",
      symbolName: "func1",
      lines: "10-20",
    });
    expect(second).toEqual({
      filepath: "file2.ts",
      content: "code2",
      type: "class",
      symbolName: null,
      lines: "5-15",
    });
  });
});
