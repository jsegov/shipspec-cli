import { describe, it, expect, beforeAll } from "vitest";
import { initTreeSitter, loadLanguage, createParser } from "../../../core/parsing/tree-sitter.js";

describe("tree-sitter", () => {
  describe("initTreeSitter", () => {
    it("initializes parser successfully", async () => {
      await expect(initTreeSitter()).resolves.not.toThrow();
    });

    it("is idempotent (can be called multiple times)", async () => {
      await initTreeSitter();
      await expect(initTreeSitter()).resolves.not.toThrow();
      await expect(initTreeSitter()).resolves.not.toThrow();
    });
  });

  describe("loadLanguage", () => {
    beforeAll(async () => {
      await initTreeSitter();
    });

    it("loads TypeScript grammar", async () => {
      const language = await loadLanguage("typescript");
      expect(language).toBeDefined();
    });

    it("loads JavaScript grammar", async () => {
      const language = await loadLanguage("javascript");
      expect(language).toBeDefined();
    });

    it("loads Python grammar", async () => {
      const language = await loadLanguage("python");
      expect(language).toBeDefined();
    });

    it("loads Go grammar", async () => {
      const language = await loadLanguage("go");
      expect(language).toBeDefined();
    });

    it("loads Rust grammar", async () => {
      const language = await loadLanguage("rust");
      expect(language).toBeDefined();
    });
  });

  describe("createParser", () => {
    beforeAll(async () => {
      await initTreeSitter();
    });

    it("returns functional parser for TypeScript", async () => {
      const parser = await createParser("typescript");
      expect(parser).toBeDefined();
      expect(parser.getLanguage()).toBeDefined();
    });

    it("returns functional parser for JavaScript", async () => {
      const parser = await createParser("javascript");
      expect(parser).toBeDefined();
      expect(parser.getLanguage()).toBeDefined();
    });

    it("returns functional parser for Python", async () => {
      const parser = await createParser("python");
      expect(parser).toBeDefined();
      expect(parser.getLanguage()).toBeDefined();
    });

    it("parser can parse simple TypeScript code", async () => {
      const parser = await createParser("typescript");
      const code = `export function add(a: number, b: number): number {
  return a + b;
}`;

      const tree = parser.parse(code);
      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.type).toBe("program");
    });

    it("parser can parse simple JavaScript code", async () => {
      const parser = await createParser("javascript");
      const code = `function add(a, b) {
  return a + b;
}`;

      const tree = parser.parse(code);
      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.type).toBe("program");
    });

    it("parser can parse simple Python code", async () => {
      const parser = await createParser("python");
      const code = `def add(a, b):
    return a + b`;

      const tree = parser.parse(code);
      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.type).toBe("module");
    });

    it("parser handles syntax errors gracefully", async () => {
      const parser = await createParser("typescript");
      const invalidCode = `function add(a: number {  // Missing closing paren
  return a + b;
}`;

      const tree = parser.parse(invalidCode);
      expect(tree).toBeDefined();
      // Tree-sitter will still create a tree, but with error nodes
      expect(tree.rootNode).toBeDefined();
    });
  });
});
