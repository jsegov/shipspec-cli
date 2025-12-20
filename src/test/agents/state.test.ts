import { describe, it, expect } from "vitest";
import {
  subtasksReducer,
  messagesReducer,
  contextReducer,
  type Subtask,
} from "../../agents/state.js";
import { CodeChunk } from "../../core/types/index.js";
import { HumanMessage } from "@langchain/core/messages";

describe("AgentState", () => {
  describe("subtasks reducer", () => {
    it("should merge subtasks by ID", () => {
      const current: Subtask[] = [
        { id: "1", query: "Query 1", status: "pending" },
        { id: "2", query: "Query 2", status: "pending" },
      ];
      
      const update: Subtask[] = [
        { id: "1", query: "Query 1", status: "complete", result: "Result 1" },
        { id: "3", query: "Query 3", status: "pending" },
      ];
      
      const result = subtasksReducer(current, update);
      
      expect(result).toHaveLength(3);
      expect(result.find((t) => t.id === "1")?.status).toBe("complete");
      expect(result.find((t) => t.id === "1")?.result).toBe("Result 1");
      expect(result.find((t) => t.id === "2")?.status).toBe("pending");
      expect(result.find((t) => t.id === "3")?.status).toBe("pending");
    });

    it("should handle empty current array", () => {
      const current: Subtask[] = [];
      const update: Subtask[] = [
        { id: "1", query: "Query 1", status: "pending" },
      ];
      
      const result = subtasksReducer(current, update);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
      expect(result[0]?.id).toBe("1");
    });

    it("should handle empty update array", () => {
      const current: Subtask[] = [
        { id: "1", query: "Query 1", status: "pending" },
      ];
      const update: Subtask[] = [];
      
      const result = subtasksReducer(current, update);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
      expect(result[0]?.id).toBe("1");
    });
  });

  describe("messages reducer", () => {
    it("should concatenate messages", () => {
      const current = [new HumanMessage("Message 1")];
      const update = [new HumanMessage("Message 2")];
      
      const result = messagesReducer(current, update);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toBeDefined();
      expect(result[0]?.content).toBe("Message 1");
      expect(result[1]).toBeDefined();
      expect(result[1]?.content).toBe("Message 2");
    });

    it("should handle empty arrays", () => {
      const result = messagesReducer([], []);
      
      expect(result).toHaveLength(0);
    });
  });

  describe("context reducer", () => {
    it("should accumulate code chunks", () => {
      const chunk1: CodeChunk = {
        id: "1",
        content: "code1",
        filepath: "file1.ts",
        startLine: 1,
        endLine: 10,
        language: "typescript",
        type: "function",
      };
      
      const chunk2: CodeChunk = {
        id: "2",
        content: "code2",
        filepath: "file2.ts",
        startLine: 1,
        endLine: 10,
        language: "typescript",
        type: "class",
      };
      
      const current = [chunk1];
      const update = [chunk2];
      
      const result = contextReducer(current, update);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toBeDefined();
      expect(result[0]?.id).toBe("1");
      expect(result[1]).toBeDefined();
      expect(result[1]?.id).toBe("2");
    });

    it("should handle empty arrays", () => {
      const result = contextReducer([], []);
      
      expect(result).toHaveLength(0);
    });
  });
});
