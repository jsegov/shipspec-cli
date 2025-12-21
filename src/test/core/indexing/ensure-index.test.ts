import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { createTempDir, cleanupTempDir, TS_FIXTURE } from "../../fixtures.js";
import { ensureIndex } from "../../../core/indexing/ensure-index.js";
import type { ShipSpecConfig } from "../../../config/schema.js";
import type { LanceDBManager } from "../../../core/storage/vector-store.js";
import type { DocumentRepository } from "../../../core/storage/repository.js";

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
    const vectorStore = {
      dropTable,
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
});
