import { describe, it, expect } from "vitest";
import { isFallbackRequired, splitWithFallback } from "../../../core/parsing/fallback-splitter.js";
import { JSON_FIXTURE, YAML_FIXTURE, MARKDOWN_FIXTURE } from "../../fixtures.js";

describe("fallback-splitter", () => {
  describe("isFallbackRequired", () => {
    it("returns true for .yaml extension", () => {
      expect(isFallbackRequired("file.yaml")).toBe(true);
      expect(isFallbackRequired("config.yaml")).toBe(true);
    });

    it("returns true for .yml extension", () => {
      expect(isFallbackRequired("file.yml")).toBe(true);
      expect(isFallbackRequired("config.yml")).toBe(true);
    });

    it("returns true for .json extension", () => {
      expect(isFallbackRequired("file.json")).toBe(true);
      expect(isFallbackRequired("package.json")).toBe(true);
    });

    it("returns true for .md extension", () => {
      expect(isFallbackRequired("file.md")).toBe(true);
      expect(isFallbackRequired("README.md")).toBe(true);
    });

    it("returns true for .sql extension", () => {
      expect(isFallbackRequired("file.sql")).toBe(true);
      expect(isFallbackRequired("query.sql")).toBe(true);
    });

    it("returns true for .toml extension", () => {
      expect(isFallbackRequired("file.toml")).toBe(true);
      expect(isFallbackRequired("Cargo.toml")).toBe(true);
    });

    it("returns true for .txt extension", () => {
      expect(isFallbackRequired("file.txt")).toBe(true);
      expect(isFallbackRequired("notes.txt")).toBe(true);
    });

    it("returns true for .csv extension", () => {
      expect(isFallbackRequired("file.csv")).toBe(true);
      expect(isFallbackRequired("data.csv")).toBe(true);
    });

    it("returns false for .ts extension", () => {
      expect(isFallbackRequired("file.ts")).toBe(false);
      expect(isFallbackRequired("component.ts")).toBe(false);
    });

    it("returns false for .js extension", () => {
      expect(isFallbackRequired("file.js")).toBe(false);
      expect(isFallbackRequired("script.js")).toBe(false);
    });

    it("returns false for .py extension", () => {
      expect(isFallbackRequired("file.py")).toBe(false);
      expect(isFallbackRequired("script.py")).toBe(false);
    });

    it("returns true for unknown extensions", () => {
      expect(isFallbackRequired("file.unknown")).toBe(true);
      expect(isFallbackRequired("file.xyz")).toBe(true);
    });

    it("returns true for files without extensions", () => {
      expect(isFallbackRequired("file")).toBe(true);
      expect(isFallbackRequired("README")).toBe(true);
    });
  });

  describe("splitWithFallback", () => {
    it("respects chunkSize option", async () => {
      const content = "a ".repeat(1000); // ~2000 characters
      const chunks = await splitWithFallback("test.txt", content, {
        chunkSize: 500,
      });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(500);
      }
    });

    it("respects chunkOverlap option", async () => {
      const content = "line 1\nline 2\nline 3\nline 4\nline 5";
      const chunks = await splitWithFallback("test.txt", content, {
        chunkSize: 20,
        chunkOverlap: 10,
      });

      // With overlap, chunks should share some content
      if (chunks.length > 1) {
        const firstChunk = chunks[0]?.content ?? "";
        const secondChunk = chunks[1]?.content ?? "";
        // There should be some overlap between chunks
        expect(
          firstChunk.includes(secondChunk.slice(0, 5)) || secondChunk.includes(firstChunk.slice(-5))
        ).toBe(true);
      }
    });

    it("returns empty array for empty content", async () => {
      const chunks = await splitWithFallback("test.txt", "");
      expect(chunks).toEqual([]);
    });

    it("returns empty array for whitespace-only content", async () => {
      const chunks = await splitWithFallback("test.txt", "   \n\n  \t  ");
      expect(chunks).toEqual([]);
    });

    it("calculates line numbers correctly", async () => {
      const content = "line 1\nline 2\nline 3\nline 4\nline 5";
      const chunks = await splitWithFallback("test.txt", content);

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.startLine).toBeGreaterThanOrEqual(0);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
        expect(chunk.endLine).toBeLessThan(5); // 0-indexed, max is 4
      }
    });

    it("returns CodeChunk with type 'module'", async () => {
      const chunks = await splitWithFallback("test.json", JSON_FIXTURE);

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.type).toBe("module");
      }
    });

    it("includes all required CodeChunk fields", async () => {
      const chunks = await splitWithFallback("test.json", JSON_FIXTURE);

      for (const chunk of chunks) {
        expect(chunk.id).toBeDefined();
        expect(chunk.content).toBeDefined();
        expect(chunk.filepath).toBe("test.json");
        expect(chunk.startLine).toBeDefined();
        expect(chunk.endLine).toBeDefined();
        expect(chunk.language).toBeDefined();
        expect(chunk.type).toBe("module");
      }
    });

    it("handles JSON files correctly", async () => {
      const chunks = await splitWithFallback("test.json", JSON_FIXTURE);

      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0];
      expect(firstChunk).toBeDefined();
      expect(firstChunk?.content).toContain("test");
      expect(firstChunk?.language).toBe("json");
    });

    it("handles YAML files correctly", async () => {
      const chunks = await splitWithFallback("test.yaml", YAML_FIXTURE);

      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0];
      expect(firstChunk).toBeDefined();
      expect(firstChunk?.content).toContain("test");
      expect(firstChunk?.language).toBe("yaml");
    });

    it("handles Markdown files correctly", async () => {
      const chunks = await splitWithFallback("test.md", MARKDOWN_FIXTURE);

      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0];
      expect(firstChunk).toBeDefined();
      expect(firstChunk?.content).toContain("Test Document");
      expect(firstChunk?.language).toBe("md");
    });

    it("uses default chunkSize when not provided", async () => {
      const content = "a ".repeat(2000); // Large content
      const chunks = await splitWithFallback("test.txt", content);

      expect(chunks.length).toBeGreaterThan(0);
      // Default chunkSize is 1500, so chunks should be around that size
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(1500);
      }
    });

    it("handles very long content by splitting into multiple chunks", async () => {
      const content = "line\n".repeat(1000); // 1000 lines
      const chunks = await splitWithFallback("test.txt", content, {
        chunkSize: 100,
        chunkOverlap: 50, // Must be less than chunkSize
      });

      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});
