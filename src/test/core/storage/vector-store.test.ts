import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LanceDBManager } from "../../../core/storage/vector-store.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import * as arrow from "apache-arrow";

describe("LanceDBManager", () => {
  let tempDir: string;
  let manager: LanceDBManager;

  beforeEach(async () => {
    tempDir = await createTempDir();
    manager = new LanceDBManager(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("connect", () => {
    it("creates database at specified path", async () => {
      const db = await manager.connect();
      expect(db).toBeDefined();
    });

    it("returns same connection on subsequent calls", async () => {
      const db1 = await manager.connect();
      const db2 = await manager.connect();
      expect(db1).toBe(db2);
    });
  });

  describe("getOrCreateTable", () => {
    it("creates new table with correct schema", async () => {
      const table = await manager.getOrCreateTable("test_table", 1536);

      expect(table).toBeDefined();
      const schema = await table.schema();

      const fields = schema.fields.map((f) => f.name);
      expect(fields).toContain("id");
      expect(fields).toContain("content");
      expect(fields).toContain("filepath");
      expect(fields).toContain("startLine");
      expect(fields).toContain("endLine");
      expect(fields).toContain("language");
      expect(fields).toContain("type");
      expect(fields).toContain("symbolName");
      expect(fields).toContain("vector");

      const vectorField = schema.fields.find((f) => f.name === "vector");
      expect(vectorField).toBeDefined();
      const vectorType = vectorField?.type as arrow.FixedSizeList;
      expect(vectorType.listSize).toBe(1536);
    });

    it("returns existing table when dimensions match", async () => {
      const table1 = await manager.getOrCreateTable("test_table", 1536);
      const table2 = await manager.getOrCreateTable("test_table", 1536);

      const schema1 = await table1.schema();
      const schema2 = await table2.schema();
      expect(schema1.fields.length).toBe(schema2.fields.length);
      const vectorField1 = schema1.fields.find((f) => f.name === "vector");
      const vectorField2 = schema2.fields.find((f) => f.name === "vector");
      expect((vectorField1?.type as arrow.FixedSizeList).listSize).toBe(
        (vectorField2?.type as arrow.FixedSizeList).listSize
      );
    });

    it("recreates table when dimensions mismatch", async () => {
      const table1 = await manager.getOrCreateTable("test_table", 1536);
      const schema1 = await table1.schema();
      const vectorField1 = schema1.fields.find((f) => f.name === "vector");
      const dims1 = (vectorField1?.type as arrow.FixedSizeList)?.listSize;
      expect(dims1).toBe(1536);

      const table2 = await manager.getOrCreateTable("test_table", 768);
      const schema2 = await table2.schema();
      const vectorField2 = schema2.fields.find((f) => f.name === "vector");
      const dims2 = (vectorField2?.type as arrow.FixedSizeList)?.listSize;
      expect(dims2).toBe(768);
    });

    it("creates FTS index on content column", async () => {
      const table = await manager.getOrCreateTable("test_table", 1536);

      const testRecord = {
        id: "test-1",
        content: "test content",
        filepath: "test.ts",
        startLine: 0,
        endLine: 1,
        language: "typescript",
        type: "function",
        symbolName: "test",
        vector: new Array(1536).fill(0.1),
      };

      await table.add([testRecord]);

      const results = await table
        .search("test content")
        .limit(10)
        .toArray();

      expect(results.length).toBeGreaterThan(0);
    });

    it("handles multiple tables independently", async () => {
      const table1 = await manager.getOrCreateTable("table1", 1536);
      const table2 = await manager.getOrCreateTable("table2", 768);

      const schema1 = await table1.schema();
      const schema2 = await table2.schema();

      const vectorField1 = schema1.fields.find((f) => f.name === "vector");
      const vectorField2 = schema2.fields.find((f) => f.name === "vector");

      const dims1 = (vectorField1?.type as arrow.FixedSizeList)?.listSize;
      const dims2 = (vectorField2?.type as arrow.FixedSizeList)?.listSize;

      expect(dims1).toBe(1536);
      expect(dims2).toBe(768);
    });

    it("schema includes all CodeChunk fields plus vector column", async () => {
      const table = await manager.getOrCreateTable("test_table", 1536);
      const schema = await table.schema();

      const fieldNames = schema.fields.map((f) => f.name);
      const expectedFields = [
        "id",
        "content",
        "filepath",
        "startLine",
        "endLine",
        "language",
        "type",
        "symbolName",
        "vector",
      ];

      for (const field of expectedFields) {
        expect(fieldNames).toContain(field);
      }
    });

    it("symbolName field is nullable", async () => {
      const table = await manager.getOrCreateTable("test_table", 1536);
      const schema = await table.schema();

      const symbolNameField = schema.fields.find((f) => f.name === "symbolName");
      expect(symbolNameField).toBeDefined();
      expect(symbolNameField?.nullable).toBe(true);
    });

    it("handles different dimension sizes", async () => {
      const dimensions = [128, 256, 512, 768, 1536];

      for (const dim of dimensions) {
        const table = await manager.getOrCreateTable(`table_${dim}`, dim);
        const schema = await table.schema();
        const vectorField = schema.fields.find((f) => f.name === "vector");
        const vectorType = vectorField?.type as arrow.FixedSizeList;
        expect(vectorType.listSize).toBe(dim);
      }
    });
  });
});
