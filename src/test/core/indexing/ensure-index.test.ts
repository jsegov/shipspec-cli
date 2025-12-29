import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { createTempDir, cleanupTempDir, TS_FIXTURE } from "../../fixtures.js";
import { ensureIndex } from "../../../core/indexing/ensure-index.js";
import type { ShipSpecConfig } from "../../../config/schema.js";
import type { LanceDBManager } from "../../../core/storage/vector-store.js";
import type { DocumentRepository } from "../../../core/storage/repository.js";
import * as parsingModule from "../../../core/parsing/index.js";

vi.mock("../../../core/storage/vector-store.js", () => ({
  LanceDBManager: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({}),
    dropTable: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../../core/storage/repository.js", () => ({
  DocumentRepository: vi.fn().mockImplementation(() => ({
    deleteByFilepath: vi.fn().mockResolvedValue(undefined),
    addDocuments: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("ensureIndex", () => {
  let tempDir: string;
  let projectPath: string;
  let manifestPath: string;
  let config: ShipSpecConfig;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectPath = join(tempDir, "project");
    await mkdir(projectPath, { recursive: true });
    manifestPath = join(tempDir, "index-manifest");

    config = {
      projectPath: projectPath,
      vectorDbPath: join(tempDir, "lancedb"),
      ignorePatterns: ["**/node_modules/**"],
      embedding: {
        provider: "openai",
        modelName: "text-embedding-3-large",
        dimensions: 3072,
        maxRetries: 3,
      },
      llm: {
        provider: "openai",
        modelName: "gpt-4",
        temperature: 0,
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      },
      checkpoint: {
        enabled: false,
        type: "memory",
      },
      productionalize: {
        coreCategories: ["security"],
      },
    } as unknown as ShipSpecConfig;
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  it("should perform full indexing when manifest is missing", async () => {
    await writeFile(join(projectPath, "test.ts"), TS_FIXTURE);

    const addDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
    const repository = {
      deleteByFilepath,
      addDocuments,
    } as unknown as DocumentRepository;

    const dropTable = vi.fn().mockResolvedValue(undefined);
    const vectorStore = {
      dropTable,
    } as unknown as LanceDBManager;

    const result = await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    expect(result.added).toBe(1);
    expect(dropTable).toHaveBeenCalledWith("code_chunks");
    expect(addDocuments).toHaveBeenCalled();

    const manifestContent = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent) as { files: Record<string, unknown> };
    expect(manifest.files["test.ts"]).toBeDefined();
  });

  it("should skip indexing when no changes detected", async () => {
    await writeFile(join(projectPath, "test.ts"), TS_FIXTURE);

    const addDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
    const repository = {
      deleteByFilepath,
      addDocuments,
    } as unknown as DocumentRepository;

    const dropTable = vi.fn().mockResolvedValue(undefined);
    // TS_FIXTURE produces 6 chunks - return matching count for integrity check
    const getTableRowCount = vi.fn().mockResolvedValue(6);
    const vectorStore = {
      dropTable,
      getTableRowCount,
    } as unknown as LanceDBManager;

    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    vi.clearAllMocks();

    const result = await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.removed).toBe(0);
    expect(addDocuments).not.toHaveBeenCalled();
  });

  it("should force re-indexing when forceReindex is true", async () => {
    await writeFile(join(projectPath, "test.ts"), TS_FIXTURE);

    const addDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
    const repository = {
      deleteByFilepath,
      addDocuments,
    } as unknown as DocumentRepository;

    const dropTable = vi.fn().mockResolvedValue(undefined);
    const vectorStore = {
      dropTable,
    } as unknown as LanceDBManager;

    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    vi.clearAllMocks();

    const result = await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
      forceReindex: true,
    });

    expect(result.added).toBe(1);
    expect(dropTable).toHaveBeenCalledWith("code_chunks");
  });

  it("should trigger full rebuild on embedding config change", async () => {
    await writeFile(join(projectPath, "test.ts"), TS_FIXTURE);

    const addDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
    const repository = {
      deleteByFilepath,
      addDocuments,
    } as unknown as DocumentRepository;

    const dropTable = vi.fn().mockResolvedValue(undefined);
    const vectorStore = {
      dropTable,
    } as unknown as LanceDBManager;

    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    vi.clearAllMocks();

    const newConfig = {
      ...config,
      embedding: {
        ...config.embedding,
        modelName: "different-model",
      },
    } as unknown as ShipSpecConfig;

    const result = await ensureIndex({
      config: newConfig,
      repository,
      vectorStore,
      manifestPath,
    });

    expect(result.added).toBe(1);
    expect(dropTable).toHaveBeenCalledWith("code_chunks");
  });

  it("should update manifest with current embedding signature during incremental indexing", async () => {
    await writeFile(join(projectPath, "test.ts"), TS_FIXTURE);

    const addDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
    const repository = {
      deleteByFilepath,
      addDocuments,
    } as unknown as DocumentRepository;

    const dropTable = vi.fn().mockResolvedValue(undefined);
    // TS_FIXTURE produces 6 chunks - return matching count for integrity check
    const getTableRowCount = vi.fn().mockResolvedValue(6);
    const vectorStore = {
      dropTable,
      getTableRowCount,
    } as unknown as LanceDBManager;

    // Initial indexing with original config
    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    // Modify file to trigger incremental update
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(join(projectPath, "test.ts"), TS_FIXTURE + "\n// Modified");

    vi.clearAllMocks();

    // Run incremental update (same config, just file changed)
    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    // Verify manifest was updated with current embedding signature
    const manifestContent = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent) as {
      embeddingSignature: { provider: string; modelName: string; dimensions: number };
    };

    expect(manifest.embeddingSignature.provider).toBe(config.embedding.provider);
    expect(manifest.embeddingSignature.modelName).toBe(config.embedding.modelName);
    expect(manifest.embeddingSignature.dimensions).toBe(config.embedding.dimensions);
  });

  it("should not save failed files in manifest during full indexing", async () => {
    // Create two files - one will succeed, one will fail
    await writeFile(join(projectPath, "success.ts"), TS_FIXTURE);
    await writeFile(join(projectPath, "failure.ts"), TS_FIXTURE);

    // Mock chunkSourceFile to fail for failure.ts
    const chunkSpy = vi.spyOn(parsingModule, "chunkSourceFile");
    chunkSpy.mockImplementation((filepath: string, content: string) => {
      if (filepath.includes("failure.ts")) {
        return Promise.reject(new Error("Simulated parsing failure"));
      }
      // Return a simple chunk for success case
      return Promise.resolve([
        {
          id: "test-chunk",
          content,
          filepath,
          startLine: 1,
          endLine: 1,
          language: "typescript",
          type: "module",
        },
      ]);
    });

    const addDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
    const repository = {
      deleteByFilepath,
      addDocuments,
    } as unknown as DocumentRepository;

    const dropTable = vi.fn().mockResolvedValue(undefined);
    const vectorStore = {
      dropTable,
    } as unknown as LanceDBManager;

    const result = await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    // Only one file should be added (the successful one)
    expect(result.added).toBe(1);

    // Verify manifest only contains the successful file
    const manifestContent = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent) as { files: Record<string, unknown> };

    expect(manifest.files["success.ts"]).toBeDefined();
    expect(manifest.files["failure.ts"]).toBeUndefined();

    chunkSpy.mockRestore();
  });

  it("should not save failed files in manifest during incremental indexing", async () => {
    // First, do initial indexing with one file
    await writeFile(join(projectPath, "initial.ts"), TS_FIXTURE);

    const addDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
    const repository = {
      deleteByFilepath,
      addDocuments,
    } as unknown as DocumentRepository;

    const dropTable = vi.fn().mockResolvedValue(undefined);
    // TS_FIXTURE produces 6 chunks - return matching count for integrity check
    const getTableRowCount = vi.fn().mockResolvedValue(6);
    const vectorStore = {
      dropTable,
      getTableRowCount,
    } as unknown as LanceDBManager;

    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    // Now add two new files - one will succeed, one will fail
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(join(projectPath, "new-success.ts"), "export const x = 1;");
    await writeFile(join(projectPath, "new-failure.ts"), "export const y = 2;");

    // Mock chunkSourceFile to fail for new-failure.ts
    const chunkSpy = vi.spyOn(parsingModule, "chunkSourceFile");
    chunkSpy.mockImplementation((filepath: string, content: string) => {
      if (filepath.includes("new-failure.ts")) {
        return Promise.reject(new Error("Simulated parsing failure"));
      }
      return Promise.resolve([
        {
          id: "test-chunk",
          content,
          filepath,
          startLine: 1,
          endLine: 1,
          language: "typescript",
          type: "module",
        },
      ]);
    });

    vi.clearAllMocks();

    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    // Verify manifest contains initial and new-success, but not new-failure
    const manifestContent = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent) as { files: Record<string, unknown> };

    expect(manifest.files["initial.ts"]).toBeDefined();
    expect(manifest.files["new-success.ts"]).toBeDefined();
    expect(manifest.files["new-failure.ts"]).toBeUndefined();

    chunkSpy.mockRestore();
  });

  it("should retry previously failed files on subsequent runs when mtime changes", async () => {
    // Create a file that will initially fail
    await writeFile(join(projectPath, "retry.ts"), TS_FIXTURE);

    // Mock chunkSourceFile to fail on first call, succeed on second
    let callCount = 0;
    const chunkSpy = vi.spyOn(parsingModule, "chunkSourceFile");
    chunkSpy.mockImplementation((filepath: string, content: string) => {
      callCount++;
      if (callCount === 1 && filepath.includes("retry.ts")) {
        return Promise.reject(new Error("Simulated first-run failure"));
      }
      return Promise.resolve([
        {
          id: "test-chunk",
          content,
          filepath,
          startLine: 1,
          endLine: 1,
          language: "typescript",
          type: "module",
        },
      ]);
    });

    const addDocuments = vi.fn().mockResolvedValue(undefined);
    const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
    const repository = {
      deleteByFilepath,
      addDocuments,
    } as unknown as DocumentRepository;

    const dropTable = vi.fn().mockResolvedValue(undefined);
    const getTableRowCount = vi.fn().mockResolvedValue(0); // Empty initially, triggers full rebuild
    const vectorStore = {
      dropTable,
      getTableRowCount,
    } as unknown as LanceDBManager;

    // First run - file fails, should NOT be in manifest
    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    let manifestContent = await readFile(manifestPath, "utf-8");
    let manifest = JSON.parse(manifestContent) as { files: Record<string, unknown> };
    expect(manifest.files["retry.ts"]).toBeUndefined();

    // Modify file to trigger re-indexing (since it's not in manifest, it will be detected as new)
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(join(projectPath, "retry.ts"), TS_FIXTURE + "\n// Modified");

    // Second run - file succeeds, should be in manifest
    await ensureIndex({
      config,
      repository,
      vectorStore,
      manifestPath,
    });

    manifestContent = await readFile(manifestPath, "utf-8");
    manifest = JSON.parse(manifestContent) as { files: Record<string, unknown> };
    expect(manifest.files["retry.ts"]).toBeDefined();

    chunkSpy.mockRestore();
  });

  describe("Vector Store Integrity", () => {
    it("should force full rebuild when manifest exists but vector store is empty", async () => {
      await writeFile(join(projectPath, "test.ts"), TS_FIXTURE);

      const addDocuments = vi.fn().mockResolvedValue(undefined);
      const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
      const repository = {
        deleteByFilepath,
        addDocuments,
      } as unknown as DocumentRepository;

      const dropTable = vi.fn().mockResolvedValue(undefined);
      const getTableRowCount = vi.fn().mockResolvedValue(0); // Empty vector store
      const vectorStore = {
        dropTable,
        getTableRowCount,
      } as unknown as LanceDBManager;

      // First indexing - creates manifest
      await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      vi.clearAllMocks();

      // Second run - manifest exists but vector store returns 0 rows
      const result = await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      // Should trigger full rebuild despite manifest existing
      expect(result.added).toBe(1);
      expect(dropTable).toHaveBeenCalledWith("code_chunks");
      expect(getTableRowCount).toHaveBeenCalledWith("code_chunks", config.embedding.dimensions);
    });

    it("should force full rebuild when vector store has significantly fewer rows than manifest chunks", async () => {
      // Create 10 files with functions (simple exports don't produce chunks)
      for (let i = 0; i < 10; i++) {
        await writeFile(
          join(projectPath, `file${String(i)}.ts`),
          `export function func${String(i)}() { return ${String(i)}; }`
        );
      }

      const addDocuments = vi.fn().mockResolvedValue(undefined);
      const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
      const repository = {
        deleteByFilepath,
        addDocuments,
      } as unknown as DocumentRepository;

      const dropTable = vi.fn().mockResolvedValue(undefined);
      // First indexing doesn't call getTableRowCount (no manifest to check integrity against)
      // Return 5 for second run - below 80% of 10 chunks threshold
      const getTableRowCount = vi.fn().mockResolvedValue(5);
      const vectorStore = {
        dropTable,
        getTableRowCount,
      } as unknown as LanceDBManager;

      // First indexing - creates manifest with 10 files and 10 chunks (1 function per file)
      await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      vi.clearAllMocks();

      // Second run - manifest tracks 10 chunks but vector store only has 5 rows
      const result = await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      // Should trigger full rebuild (5 < 10 * 0.8 = 8)
      expect(result.added).toBe(10);
      expect(dropTable).toHaveBeenCalledWith("code_chunks");
    });

    it("should allow incremental update when row count meets threshold", async () => {
      // Create 10 files with functions (simple exports don't produce chunks)
      for (let i = 0; i < 10; i++) {
        await writeFile(
          join(projectPath, `file${String(i)}.ts`),
          `export function func${String(i)}() { return ${String(i)}; }`
        );
      }

      const addDocuments = vi.fn().mockResolvedValue(undefined);
      const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
      const repository = {
        deleteByFilepath,
        addDocuments,
      } as unknown as DocumentRepository;

      const dropTable = vi.fn().mockResolvedValue(undefined);
      // First indexing doesn't call getTableRowCount (no manifest to check integrity against)
      // Return 9 for second run - above 80% of 10 chunks threshold
      const getTableRowCount = vi.fn().mockResolvedValue(9);
      const vectorStore = {
        dropTable,
        getTableRowCount,
      } as unknown as LanceDBManager;

      // First indexing - creates manifest with 10 files and 10 chunks (1 function per file)
      await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      vi.clearAllMocks();

      // Second run - manifest tracks 10 chunks and vector store has 9 rows (>= 80%)
      const result = await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      // Should NOT trigger full rebuild - incremental update with no changes
      expect(result.added).toBe(0);
      expect(result.modified).toBe(0);
      expect(result.removed).toBe(0);
      expect(dropTable).not.toHaveBeenCalled();
    });
  });

  describe("Safe Chunk Deletion", () => {
    it("should not delete old chunks if parsing fails", async () => {
      await writeFile(join(projectPath, "test.ts"), TS_FIXTURE);

      const addDocuments = vi.fn().mockResolvedValue(undefined);
      const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
      const repository = {
        deleteByFilepath,
        addDocuments,
      } as unknown as DocumentRepository;

      const dropTable = vi.fn().mockResolvedValue(undefined);
      // TS_FIXTURE produces 6 chunks - return matching count for integrity check
      const getTableRowCount = vi.fn().mockResolvedValue(6);
      const vectorStore = {
        dropTable,
        getTableRowCount,
      } as unknown as LanceDBManager;

      // First indexing
      await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      // Modify file to trigger re-indexing
      await new Promise((r) => setTimeout(r, 100));
      await writeFile(join(projectPath, "test.ts"), TS_FIXTURE + "\n// Modified");

      vi.clearAllMocks();

      // Mock chunkSourceFile to fail
      const chunkSpy = vi.spyOn(parsingModule, "chunkSourceFile");
      chunkSpy.mockRejectedValue(new Error("Simulated parsing failure"));

      await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      // deleteByFilepath should NOT be called because parse failed first
      expect(deleteByFilepath).not.toHaveBeenCalled();

      chunkSpy.mockRestore();
    });

    it("should delete old chunks only after successful parse", async () => {
      await writeFile(join(projectPath, "test.ts"), TS_FIXTURE);

      const addDocuments = vi.fn().mockResolvedValue(undefined);
      const deleteByFilepath = vi.fn().mockResolvedValue(undefined);
      const repository = {
        deleteByFilepath,
        addDocuments,
      } as unknown as DocumentRepository;

      const dropTable = vi.fn().mockResolvedValue(undefined);
      // TS_FIXTURE produces 6 chunks - return matching count for integrity check
      const getTableRowCount = vi.fn().mockResolvedValue(6);
      const vectorStore = {
        dropTable,
        getTableRowCount,
      } as unknown as LanceDBManager;

      // First indexing
      await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      // Modify file to trigger re-indexing
      await new Promise((r) => setTimeout(r, 100));
      await writeFile(join(projectPath, "test.ts"), TS_FIXTURE + "\n// Modified");

      vi.clearAllMocks();

      // Track the order of calls
      const callOrder: string[] = [];
      const chunkSpy = vi.spyOn(parsingModule, "chunkSourceFile");
      chunkSpy.mockImplementation((filepath: string, content: string) => {
        callOrder.push("parse");
        return Promise.resolve([
          {
            id: "test-chunk",
            content,
            filepath,
            startLine: 1,
            endLine: 1,
            language: "typescript",
            type: "module",
          },
        ]);
      });

      deleteByFilepath.mockImplementation(() => {
        callOrder.push("delete");
        return Promise.resolve();
      });

      await ensureIndex({
        config,
        repository,
        vectorStore,
        manifestPath,
      });

      // Parse should happen before delete
      expect(callOrder).toEqual(["parse", "delete"]);
      expect(deleteByFilepath).toHaveBeenCalledWith("test.ts");

      chunkSpy.mockRestore();
    });
  });
});
