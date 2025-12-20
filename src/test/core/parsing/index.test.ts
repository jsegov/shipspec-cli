import { describe, it, expect, beforeAll } from "vitest";
import { chunkSourceFile } from "../../../core/parsing/index.js";
import {
  SemanticChunker,
  createParser,
  getLanguageFromExtension,
  isFallbackRequired,
  splitWithFallback,
} from "../../../core/parsing/index.js";
import { TS_FIXTURE, JSON_FIXTURE } from "../../fixtures.js";

describe("parsing/index", () => {
  beforeAll(async () => {
    const { initTreeSitter } = await import("../../../core/parsing/tree-sitter.js");
    await initTreeSitter();
  });

  describe("chunkSourceFile", () => {
    it("routes .json to fallback splitter", async () => {
      const chunks = await chunkSourceFile("test.json", JSON_FIXTURE);

      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0];
      expect(firstChunk?.type).toBe("module");
      expect(firstChunk?.language).toBe("json");
    });

    it("routes .ts to SemanticChunker", async () => {
      const chunks = await chunkSourceFile("test.ts", TS_FIXTURE);

      expect(chunks.length).toBeGreaterThan(0);
      const hasFunction = chunks.some(
        (chunk) => chunk.type === "function" || chunk.type === "class"
      );
      expect(hasFunction).toBe(true);
    });

    it("falls back gracefully on parse errors", async () => {
      const invalidCode = `function broken {
  const x = 
}`;

      const chunks = await chunkSourceFile("test.ts", invalidCode);

      expect(Array.isArray(chunks)).toBe(true);
      if (chunks.length > 0) {
        const firstChunk = chunks[0];
        expect(firstChunk?.type).toBe("module");
      }
    });

    it("handles empty content", async () => {
      const chunks = await chunkSourceFile("test.ts", "");
      expect(chunks).toEqual([]);
    });

    it("handles whitespace-only content", async () => {
      const chunks = await chunkSourceFile("test.ts", "   \n\n  \t  ");
      expect(chunks).toEqual([]);
    });

    it("routes .yaml to fallback splitter", async () => {
      const yamlContent = "name: test\nversion: 1.0.0";
      const chunks = await chunkSourceFile("test.yaml", yamlContent);

      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0];
      expect(firstChunk?.type).toBe("module");
    });

    it("routes .md to fallback splitter", async () => {
      const mdContent = "# Title\n\nSome content";
      const chunks = await chunkSourceFile("test.md", mdContent);

      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0];
      expect(firstChunk?.type).toBe("module");
    });

    it("routes .py to SemanticChunker", async () => {
      const pythonCode = `def add(a, b):
    return a + b`;
      const chunks = await chunkSourceFile("test.py", pythonCode);

      expect(chunks.length).toBeGreaterThan(0);
      const hasFunction = chunks.some((chunk) => chunk.type === "function");
      expect(hasFunction).toBe(true);
    });
  });

  describe("exports", () => {
    it("exports SemanticChunker", () => {
      expect(SemanticChunker).toBeDefined();
      expect(typeof SemanticChunker).toBe("function");
    });

    it("exports createParser", () => {
      expect(createParser).toBeDefined();
      expect(typeof createParser).toBe("function");
    });

    it("exports getLanguageFromExtension", () => {
      expect(getLanguageFromExtension).toBeDefined();
      expect(typeof getLanguageFromExtension).toBe("function");
    });

    it("exports isFallbackRequired", () => {
      expect(isFallbackRequired).toBeDefined();
      expect(typeof isFallbackRequired).toBe("function");
    });

    it("exports splitWithFallback", () => {
      expect(splitWithFallback).toBeDefined();
      expect(typeof splitWithFallback).toBe("function");
    });
  });
});
