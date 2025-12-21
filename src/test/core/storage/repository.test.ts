import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DocumentRepository } from "../../../core/storage/repository.js";
import { LanceDBManager } from "../../../core/storage/vector-store.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { Embeddings } from "@langchain/core/embeddings";
import { Table } from "@lancedb/lancedb";
import { CodeChunk } from "../../../core/types/index.js";

class MockEmbeddings extends Embeddings {
  constructor(private dimensions: number) {
    super({});
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map(() => new Array<number>(this.dimensions).fill(0.1)));
  }

  embedQuery(_text: string): Promise<number[]> {
    return Promise.resolve(new Array<number>(this.dimensions).fill(0.1));
  }
}

describe("DocumentRepository", () => {
  describe("Unit Tests (mocked dependencies)", () => {
    let mockVectorStore: Partial<LanceDBManager>;
    let mockEmbeddings: {
      embedDocuments: ReturnType<typeof vi.fn>;
      embedQuery: ReturnType<typeof vi.fn>;
    };
    let repository: DocumentRepository;

    beforeEach(() => {
      mockVectorStore = {
        getOrCreateTable: vi.fn(),
      };

      mockEmbeddings = {
        embedDocuments: vi.fn().mockResolvedValue([
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ]),
        embedQuery: vi.fn().mockResolvedValue([0.7, 0.8, 0.9]),
      };

      repository = new DocumentRepository(
        mockVectorStore as LanceDBManager,
        mockEmbeddings as unknown as Embeddings,
        3072
      );
    });

    it("addDocuments calls embeddings and stores records", async () => {
      const mockTable = {
        add: vi.fn().mockResolvedValue(undefined),
      };
      const getOrCreateTable = mockVectorStore.getOrCreateTable;
      if (!getOrCreateTable) throw new Error("getOrCreateTable not defined");
      vi.mocked(getOrCreateTable).mockResolvedValue(mockTable as unknown as Table);

      const chunks: CodeChunk[] = [
        {
          id: "1",
          content: "test content 1",
          filepath: "test.ts",
          startLine: 0,
          endLine: 1,
          language: "typescript",
          type: "function",
        },
        {
          id: "2",
          content: "test content 2",
          filepath: "test.ts",
          startLine: 2,
          endLine: 3,
          language: "typescript",
          type: "function",
        },
      ];

      await repository.addDocuments(chunks);

      expect(mockEmbeddings.embedDocuments).toHaveBeenCalledWith([
        "test content 1",
        "test content 2",
      ]);
      expect(mockTable.add).toHaveBeenCalledWith([
        {
          ...chunks[0],
          vector: [0.1, 0.2, 0.3],
        },
        {
          ...chunks[1],
          vector: [0.4, 0.5, 0.6],
        },
      ]);
    });

    it("addDocuments handles empty array gracefully", async () => {
      await repository.addDocuments([]);

      expect(mockEmbeddings.embedDocuments).not.toHaveBeenCalled();
      expect(mockVectorStore.getOrCreateTable).not.toHaveBeenCalled();
    });

    it("similaritySearch returns results as CodeChunk objects", async () => {
      const mockTable = {
        vectorSearch: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              {
                id: "1",
                content: "test",
                filepath: "test.ts",
                startLine: 0,
                endLine: 1,
                language: "typescript",
                type: "function",
                vector: [0.1, 0.2, 0.3],
                _distance: 0.5,
              },
            ]),
          }),
        }),
      };
      const getOrCreateTable = mockVectorStore.getOrCreateTable;
      if (!getOrCreateTable) throw new Error("getOrCreateTable not defined");
      vi.mocked(getOrCreateTable).mockResolvedValue(mockTable as unknown as Table);

      const results = await repository.similaritySearch("test query", 10);

      expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith("test query");
      expect(results).toHaveLength(1);
      expect(results[0]).not.toHaveProperty("vector");
      expect(results[0]).not.toHaveProperty("_distance");
      expect(results[0]).toHaveProperty("id", "1");
    });

    it("hybridSearch uses correct search mode", async () => {
      const mockTable = {
        search: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              {
                id: "1",
                content: "test",
                filepath: "test.ts",
                startLine: 0,
                endLine: 1,
                language: "typescript",
                type: "function",
                vector: [0.1, 0.2, 0.3],
                _distance: 0.5,
              },
            ]),
          }),
        }),
      };
      const getOrCreateTable = mockVectorStore.getOrCreateTable;
      if (!getOrCreateTable) throw new Error("getOrCreateTable not defined");
      vi.mocked(getOrCreateTable).mockResolvedValue(mockTable as unknown as Table);

      const results = await repository.hybridSearch("test query", 10);

      expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith("test query");
      expect(mockTable.search).toHaveBeenCalledWith([0.7, 0.8, 0.9], "hybrid");
      expect(results).toHaveLength(1);
    });

    it("deleteByFilepath escapes SQL quotes correctly", async () => {
      const mockTable = {
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const getOrCreateTable = mockVectorStore.getOrCreateTable;
      if (!getOrCreateTable) throw new Error("getOrCreateTable not defined");
      vi.mocked(getOrCreateTable).mockResolvedValue(mockTable as unknown as Table);

      await repository.deleteByFilepath("test's file.ts");

      expect(mockTable.delete).toHaveBeenCalledWith("filepath = 'test''s file.ts'");
    });
  });

  describe("Integration Tests (real LanceDB + MockEmbeddings)", () => {
    let tempDir: string;
    let vectorStore: LanceDBManager;
    let embeddings: MockEmbeddings;
    let repository: DocumentRepository;

    beforeEach(async () => {
      tempDir = await createTempDir();
      vectorStore = new LanceDBManager(tempDir);
      embeddings = new MockEmbeddings(3072);
      repository = new DocumentRepository(vectorStore, embeddings, 3072);
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("full flow: add documents, search, delete", async () => {
      const chunks: CodeChunk[] = [
        {
          id: "chunk-1",
          content: "function add(a, b) { return a + b; }",
          filepath: "math.ts",
          startLine: 0,
          endLine: 1,
          language: "typescript",
          type: "function",
          symbolName: "add",
        },
        {
          id: "chunk-2",
          content: "function multiply(a, b) { return a * b; }",
          filepath: "math.ts",
          startLine: 2,
          endLine: 3,
          language: "typescript",
          type: "function",
          symbolName: "multiply",
        },
        {
          id: "chunk-3",
          content: "class Calculator { }",
          filepath: "calc.ts",
          startLine: 0,
          endLine: 1,
          language: "typescript",
          type: "class",
          symbolName: "Calculator",
        },
      ];

      await repository.addDocuments(chunks);

      const similarityResults = await repository.similaritySearch("add function", 5);
      expect(similarityResults.length).toBeGreaterThan(0);
      expect(similarityResults.some((r) => r.id === "chunk-1")).toBe(true);

      const hybridResults = await repository.hybridSearch("multiply", 5);
      expect(hybridResults.length).toBeGreaterThan(0);
      expect(hybridResults.some((r) => r.id === "chunk-2")).toBe(true);

      await repository.deleteByFilepath("math.ts");

      const afterDeleteResults = await repository.similaritySearch("add", 10);
      const mathChunks = afterDeleteResults.filter((r) => r.filepath === "math.ts");
      expect(mathChunks.length).toBe(0);

      const calcResults = await repository.similaritySearch("Calculator", 10);
      expect(calcResults.some((r) => r.filepath === "calc.ts")).toBe(true);
    });

    it("handles empty search results", async () => {
      const results = await repository.similaritySearch("nonexistent", 10);
      expect(results).toEqual([]);
    });

    it("respects k parameter in search", async () => {
      const chunks: CodeChunk[] = Array.from({ length: 20 }, (_, i) => ({
        id: `chunk-${String(i)}`,
        content: `function func${String(i)}() { }`,
        filepath: "test.ts",
        startLine: i,
        endLine: i + 1,
        language: "typescript",
        type: "function",
        symbolName: `func${String(i)}`,
      }));

      await repository.addDocuments(chunks);

      const results = await repository.similaritySearch("function", 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });
});
