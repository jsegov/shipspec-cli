import { describe, it, expect } from "vitest";
import {
  countTokensApprox,
  countChunkTokens,
  pruneChunksByTokenBudget,
  truncateTextByTokenBudget,
  getAvailableContextBudget,
  type TokenBudget,
} from "../../utils/tokens.js";
import type { CodeChunk } from "../../core/types/index.js";

describe("Token Utilities", () => {
  describe("countTokensApprox", () => {
    it("estimates tokens at ~4 characters per token", () => {
      // 20 characters should be ~5 tokens
      expect(countTokensApprox("12345678901234567890")).toBe(5);
    });

    it("rounds up for partial tokens", () => {
      // 5 characters should round up to 2 tokens
      expect(countTokensApprox("12345")).toBe(2);
    });

    it("returns 0 for empty string", () => {
      expect(countTokensApprox("")).toBe(0);
    });

    it("handles single character", () => {
      expect(countTokensApprox("a")).toBe(1);
    });
  });

  describe("countChunkTokens", () => {
    it("sums tokens across all chunks", () => {
      const chunks: CodeChunk[] = [
        {
          id: "1",
          content: "12345678901234567890", // 5 tokens
          filepath: "test.ts",
          startLine: 1,
          endLine: 5,
          language: "typescript",
          type: "function",
        },
        {
          id: "2",
          content: "1234567890", // 3 tokens (rounds up from 2.5)
          filepath: "test.ts",
          startLine: 6,
          endLine: 10,
          language: "typescript",
          type: "function",
        },
      ];

      expect(countChunkTokens(chunks)).toBe(8); // 5 + 3
    });

    it("returns 0 for empty array", () => {
      expect(countChunkTokens([])).toBe(0);
    });
  });

  describe("pruneChunksByTokenBudget", () => {
    const createChunk = (id: string, content: string): CodeChunk => ({
      id,
      content,
      filepath: "test.ts",
      startLine: 1,
      endLine: 5,
      language: "typescript",
      type: "function",
    });

    it("returns all chunks when within budget", () => {
      const chunks = [
        createChunk("1", "1234"), // 1 token
        createChunk("2", "5678"), // 1 token
      ];

      const result = pruneChunksByTokenBudget(chunks, 10);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("1");
      expect(result[1].id).toBe("2");
    });

    it("prunes chunks that exceed budget", () => {
      const chunks = [
        createChunk("1", "12345678901234567890"), // 5 tokens
        createChunk("2", "12345678901234567890"), // 5 tokens
        createChunk("3", "12345678901234567890"), // 5 tokens
      ];

      const result = pruneChunksByTokenBudget(chunks, 8);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("1");
    });

    it("keeps order when pruning", () => {
      const chunks = [
        createChunk("1", "1234"), // 1 token
        createChunk("2", "5678"), // 1 token
        createChunk("3", "90ab"), // 1 token
      ];

      const result = pruneChunksByTokenBudget(chunks, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("1");
      expect(result[1].id).toBe("2");
    });

    it("returns empty array when first chunk exceeds budget", () => {
      const chunks = [createChunk("1", "12345678901234567890")]; // 5 tokens

      const result = pruneChunksByTokenBudget(chunks, 2);

      expect(result).toHaveLength(0);
    });

    it("returns empty array for empty input", () => {
      const result = pruneChunksByTokenBudget([], 10);

      expect(result).toHaveLength(0);
    });
  });

  describe("truncateTextByTokenBudget", () => {
    it("returns original text when within budget", () => {
      const text = "Hello world";

      const result = truncateTextByTokenBudget(text, 100);

      expect(result).toBe(text);
    });

    it("truncates text that exceeds budget", () => {
      const text = "a".repeat(1000);

      const result = truncateTextByTokenBudget(text, 50);

      expect(result).toContain("[... content truncated");
    });

    it("tries to break at newline", () => {
      const text = "First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line\nSeventh line";

      const result = truncateTextByTokenBudget(text, 10); // ~40 chars

      expect(result).toContain("truncated");
    });

    it("handles text without good break points", () => {
      // Long text without spaces, newlines, or periods
      const text = "a".repeat(500);

      const result = truncateTextByTokenBudget(text, 25); // ~100 chars budget

      expect(result).toContain("truncated");
    });
  });

  describe("getAvailableContextBudget", () => {
    it("subtracts reserved output tokens from max context", () => {
      const budget: TokenBudget = {
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      };

      expect(getAvailableContextBudget(budget)).toBe(12000);
    });

    it("returns 0 when reserved exceeds max", () => {
      const budget: TokenBudget = {
        maxContextTokens: 1000,
        reservedOutputTokens: 2000,
      };

      expect(getAvailableContextBudget(budget)).toBe(0);
    });

    it("handles equal values", () => {
      const budget: TokenBudget = {
        maxContextTokens: 4000,
        reservedOutputTokens: 4000,
      };

      expect(getAvailableContextBudget(budget)).toBe(0);
    });
  });
});
