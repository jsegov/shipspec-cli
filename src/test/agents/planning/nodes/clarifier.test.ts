/**
 * Tests for the clarifier node.
 * Covers the logic for determining when clarification is complete.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PlanningStateType } from "../../../../agents/planning/state.js";

// Mock the interrupt function from LangGraph
vi.mock("@langchain/langgraph", () => ({
  interrupt: vi.fn(),
}));

// Import after mocking
import { createClarifierNode } from "../../../../agents/planning/nodes/clarifier.js";
import { interrupt } from "@langchain/langgraph";

describe("Clarifier Node", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockModel: BaseChatModel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke = vi.fn();
    mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: mockInvoke,
      }),
    } as unknown as BaseChatModel;
  });

  const createBaseState = (overrides: Partial<PlanningStateType> = {}): PlanningStateType =>
    ({
      initialIdea: "Build a todo app",
      phase: "clarifying",
      signals: null,
      codeContext: "",
      clarificationHistory: [],
      clarificationComplete: false,
      pendingQuestions: [],
      prd: "",
      techSpec: "",
      taskPrompts: "",
      userFeedback: "",
      messages: [],
      ...overrides,
    }) as PlanningStateType;

  describe("when LLM is satisfied", () => {
    it("should mark clarification complete when satisfied is true", async () => {
      mockInvoke.mockResolvedValue({
        satisfied: true,
        followUpQuestions: [],
        reasoning: "Requirements are clear enough to proceed",
      });

      const node = createClarifierNode(mockModel);
      const state = createBaseState();

      const result = await node(state);

      expect(result.clarificationComplete).toBe(true);
      expect(result.phase).toBe("prd_review");
    });

    it("should mark clarification complete even if satisfied with questions provided", async () => {
      // Edge case: LLM says satisfied but still provides questions (should trust satisfied flag)
      mockInvoke.mockResolvedValue({
        satisfied: true,
        followUpQuestions: ["What about edge cases?"],
        reasoning: "I have enough info but could use more",
      });

      const node = createClarifierNode(mockModel);
      const state = createBaseState();

      const result = await node(state);

      expect(result.clarificationComplete).toBe(true);
      expect(result.phase).toBe("prd_review");
      // Should not store questions if satisfied
      expect(result.pendingQuestions).toBeUndefined();
    });
  });

  describe("when LLM is not satisfied", () => {
    it("should store pending questions when not satisfied with questions", async () => {
      mockInvoke.mockResolvedValue({
        satisfied: false,
        followUpQuestions: ["What is the target audience?", "What is the deadline?"],
        reasoning: "Need more details about scope",
      });

      const node = createClarifierNode(mockModel);
      const state = createBaseState();

      const result = await node(state);

      expect(result.pendingQuestions).toEqual([
        "What is the target audience?",
        "What is the deadline?",
      ]);
      // Should NOT mark clarification complete
      expect(result.clarificationComplete).toBeUndefined();
      expect(result.phase).toBeUndefined();
    });

    it("should proceed with warning when not satisfied but no questions provided (bug fix)", async () => {
      // This is the bug fix case: LLM returns satisfied: false with empty questions
      // Previously this would incorrectly proceed silently; now it logs a warning
      mockInvoke.mockResolvedValue({
        satisfied: false,
        followUpQuestions: [],
        reasoning: "I need more information but cannot formulate questions",
      });

      const node = createClarifierNode(mockModel);
      const state = createBaseState();

      const result = await node(state);

      // Should proceed to avoid infinite loop, but this is an edge case
      expect(result.clarificationComplete).toBe(true);
      expect(result.phase).toBe("prd_review");
    });
  });

  describe("when clarification is already complete", () => {
    it("should transition to PRD phase without calling LLM", async () => {
      const node = createClarifierNode(mockModel);
      const state = createBaseState({ clarificationComplete: true });

      const result = await node(state);

      expect(result.phase).toBe("prd_review");
      // LLM should not be called
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe("when pending questions exist", () => {
    it("should interrupt for user answers", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue({ "0": "Developers", "1": "Next month" });

      const node = createClarifierNode(mockModel);
      const state = createBaseState({
        pendingQuestions: ["What is the target audience?", "What is the deadline?"],
      });

      const result = await node(state);

      // Should have called interrupt with questions
      expect(mockedInterrupt).toHaveBeenCalledWith({
        type: "clarification",
        questions: ["What is the target audience?", "What is the deadline?"],
      });

      // Should return new history entries and clear pending questions
      expect(result.clarificationHistory).toEqual([
        { question: "What is the target audience?", answer: "Developers" },
        { question: "What is the deadline?", answer: "Next month" },
      ]);
      expect(result.pendingQuestions).toEqual([]);

      // LLM should not be called when processing interrupt response
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("should handle missing answers gracefully", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      // Only one answer provided for two questions
      mockedInterrupt.mockReturnValue({ "0": "Developers" });

      const node = createClarifierNode(mockModel);
      const state = createBaseState({
        pendingQuestions: ["What is the target audience?", "What is the deadline?"],
      });

      const result = await node(state);

      // Should use empty string for missing answer
      expect(result.clarificationHistory).toEqual([
        { question: "What is the target audience?", answer: "Developers" },
        { question: "What is the deadline?", answer: "" },
      ]);
    });

    it("should throw on invalid interrupt response", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("invalid string response");

      const node = createClarifierNode(mockModel);
      const state = createBaseState({
        pendingQuestions: ["What is the target audience?"],
      });

      await expect(node(state)).rejects.toThrow("Invalid interrupt response");
    });
  });
});
