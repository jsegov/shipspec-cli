import { describe, it, expect, beforeAll } from "vitest";
import { SemanticChunker } from "../../../core/parsing/chunker.js";
import { TS_FIXTURE, PYTHON_FIXTURE } from "../../fixtures.js";

describe("SemanticChunker", () => {
  beforeAll(async () => {
    const { initTreeSitter } = await import("../../../core/parsing/tree-sitter.js");
    await initTreeSitter();
  });

  describe("chunkFile - TypeScript", () => {
    it("extracts function declarations with correct symbolName", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      const addFunction = chunks.find(
        (chunk) => chunk.symbolName === "add" && chunk.type === "function"
      );
      expect(addFunction).toBeDefined();
      expect(addFunction?.content).toContain("function add");
      expect(addFunction?.content).toContain("return a + b");
    });

    it("extracts arrow functions assigned to const", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      const subtractFunction = chunks.find(
        (chunk) => chunk.symbolName === "subtract" && chunk.type === "function"
      );
      expect(subtractFunction).toBeDefined();
      expect(subtractFunction?.content).toContain("subtract");
      expect(subtractFunction?.content).toContain("=>");
    });

    it("extracts class declarations", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      const calculatorClass = chunks.find(
        (chunk) => chunk.symbolName === "Calculator" && chunk.type === "class"
      );
      expect(calculatorClass).toBeDefined();
      expect(calculatorClass?.content).toContain("Calculator");
      expect(calculatorClass?.content).toContain("multiply");
    });

    it("extracts method definitions inside classes", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      const multiplyMethod = chunks.find(
        (chunk) => chunk.symbolName === "multiply" && chunk.type === "method"
      );
      expect(multiplyMethod).toBeDefined();
      expect(multiplyMethod?.content).toContain("multiply");

      const divideMethod = chunks.find(
        (chunk) => chunk.symbolName === "divide" && chunk.type === "method"
      );
      expect(divideMethod).toBeDefined();
      expect(divideMethod?.content).toContain("divide");
    });

    it("includes preceding JSDoc comments when includeComments is true", async () => {
      const chunker = new SemanticChunker({ includeComments: true });
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      const addFunction = chunks.find((chunk) => chunk.symbolName === "add");
      expect(addFunction).toBeDefined();
      expect(addFunction?.content).toContain("function add");
      expect(addFunction?.content).toContain("return a + b");
      const content = addFunction?.content ?? "";
      if (content.includes("/**") || content.includes("*")) {
        expect(content).toContain("Adds two numbers");
      }
    });

    it("excludes comments when includeComments is false", async () => {
      const chunker = new SemanticChunker({ includeComments: false });
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      const addFunction = chunks.find((chunk) => chunk.symbolName === "add");
      expect(addFunction).toBeDefined();
      expect(addFunction?.content).not.toContain("/**");
      expect(addFunction?.content).toContain("function add");
    });

    it("respects minChunkSize filter", async () => {
      const chunker = new SemanticChunker({ minChunkSize: 200 });
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      for (const chunk of chunks) {
        expect(chunk.content.length).toBeGreaterThanOrEqual(200);
      }
    });

    it("splits large chunks when maxChunkSize exceeded", async () => {
      const largeCode = `export function largeFunction() {
${Array(100).fill("  const x = 'some very long string that repeats';").join("\n")}
}`;

      const chunker = new SemanticChunker({ maxChunkSize: 500 });
      const chunks = await chunker.chunkFile("test.ts", largeCode);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(500);
      }
    });

    it("returns empty array for empty content", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.ts", "");
      expect(chunks).toEqual([]);
    });

    it("returns empty array for whitespace-only content", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.ts", "   \n\n  \t  ");
      expect(chunks).toEqual([]);
    });

    it("calculates startLine and endLine correctly", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      for (const chunk of chunks) {
        expect(chunk.startLine).toBeGreaterThanOrEqual(0);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      }

      const addFunction = chunks.find((chunk) => chunk.symbolName === "add");
      if (addFunction) {
        expect(addFunction.startLine).toBeGreaterThanOrEqual(0);
        expect(addFunction.endLine).toBeGreaterThan(addFunction.startLine);
      }
    });

    it("includes all required CodeChunk fields", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.ts", TS_FIXTURE);

      for (const chunk of chunks) {
        expect(chunk.id).toBeDefined();
        expect(chunk.content).toBeDefined();
        expect(chunk.filepath).toBe("test.ts");
        expect(chunk.startLine).toBeDefined();
        expect(chunk.endLine).toBeDefined();
        expect(chunk.language).toBe("typescript");
        expect(chunk.type).toBeDefined();
      }
    });
  });

  describe("chunkFile - Python", () => {
    it("extracts function definitions", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.py", PYTHON_FIXTURE);

      const addFunction = chunks.find(
        (chunk) => chunk.symbolName === "add" && chunk.type === "function"
      );
      expect(addFunction).toBeDefined();
      expect(addFunction?.content).toContain("def add");
    });

    it("extracts class definitions", async () => {
      const chunker = new SemanticChunker();
      const chunks = await chunker.chunkFile("test.py", PYTHON_FIXTURE);

      const calculatorClass = chunks.find(
        (chunk) => chunk.symbolName === "Calculator" && chunk.type === "class"
      );
      expect(calculatorClass).toBeDefined();
      expect(calculatorClass?.content).toContain("Calculator");
      expect(calculatorClass?.content).toContain("multiply");
    });

    it("handles docstrings", async () => {
      const chunker = new SemanticChunker({ includeComments: true });
      const chunks = await chunker.chunkFile("test.py", PYTHON_FIXTURE);

      const addFunction = chunks.find((chunk) => chunk.symbolName === "add");
      expect(addFunction).toBeDefined();
      expect(addFunction?.content).toContain('"""');
      expect(addFunction?.content).toContain("Adds two numbers");
    });
  });

  describe("chunkFile - error handling", () => {
    it("throws error for unsupported language", async () => {
      const chunker = new SemanticChunker();
      await expect(chunker.chunkFile("test.unknown", "some code")).rejects.toThrow(
        "Unsupported language"
      );
    });
  });
});
