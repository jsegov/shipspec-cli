/**
 * Tests for the PRD generator node.
 * Covers the two-phase interrupt pattern to ensure document consistency.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PlanningStateType } from "../../../../agents/planning/state.js";

// Mock the interrupt function from LangGraph
vi.mock("@langchain/langgraph", () => ({
  interrupt: vi.fn(),
}));

// Import after mocking
import { createPRDGeneratorNode } from "../../../../agents/planning/nodes/prd-generator.js";
import { interrupt } from "@langchain/langgraph";

describe("PRD Generator Node", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockModel: BaseChatModel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke = vi.fn();
    mockModel = {
      invoke: mockInvoke,
    } as unknown as BaseChatModel;
  });

  const createBaseState = (overrides: Partial<PlanningStateType> = {}): PlanningStateType =>
    ({
      initialIdea: "Build a todo app",
      phase: "prd_review",
      signals: null,
      codeContext: "",
      clarificationHistory: [],
      clarificationComplete: true,
      pendingQuestions: [],
      pendingPrd: "",
      pendingTechSpec: "",
      prd: "",
      techSpec: "",
      taskPrompts: "",
      userFeedback: "",
      messages: [],
      ...overrides,
    }) as PlanningStateType;

  describe("Phase 1: Document Generation", () => {
    it("should generate PRD and store in pendingPrd without interrupting", async () => {
      mockInvoke.mockResolvedValue({
        content: "# Product Requirements Document\n\nGenerated PRD content",
      });

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState();

      const result = await node(state);

      // Should store in pendingPrd, NOT in prd
      expect(result.pendingPrd).toBe("# Product Requirements Document\n\nGenerated PRD content");
      expect(result.prd).toBeUndefined();

      // Should NOT call interrupt in Phase 1
      expect(interrupt).not.toHaveBeenCalled();
    });

    it("should clear userFeedback after regeneration", async () => {
      mockInvoke.mockResolvedValue({
        content: "Revised PRD content",
      });

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState({
        userFeedback: "Add more details about auth",
      });

      const result = await node(state);

      expect(result.userFeedback).toBe("");
    });
  });

  describe("Phase 2: Interrupt for Review", () => {
    it("should interrupt with pendingPrd when it exists", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("approve");

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState({
        pendingPrd: "# PRD v1\n\nPending for review",
      });

      await node(state);

      // Should call interrupt with the pending document
      expect(mockedInterrupt).toHaveBeenCalledWith({
        type: "prd_review",
        document: "# PRD v1\n\nPending for review",
        instructions:
          "Review the PRD. Reply 'approve' to continue or provide feedback for revision.",
      });

      // Should NOT call LLM when we have a pending document
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("should move pendingPrd to prd on approval", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("approve");

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState({
        pendingPrd: "# PRD v1\n\nApproved content",
      });

      const result = await node(state);

      // Should move pending to final
      expect(result.prd).toBe("# PRD v1\n\nApproved content");
      expect(result.pendingPrd).toBe("");
      expect(result.phase).toBe("spec_review");
      expect(result.userFeedback).toBe("");
    });

    it("should handle case-insensitive approval", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("APPROVE");

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState({
        pendingPrd: "# PRD v1",
      });

      const result = await node(state);

      expect(result.prd).toBe("# PRD v1");
      expect(result.phase).toBe("spec_review");
    });

    it("should handle approval with whitespace", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("  approve  ");

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState({
        pendingPrd: "# PRD v1",
      });

      const result = await node(state);

      expect(result.prd).toBe("# PRD v1");
      expect(result.phase).toBe("spec_review");
    });

    it("should clear pendingPrd and store feedback for revision", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("Add more details about user authentication");

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState({
        pendingPrd: "# PRD v1\n\nNeeds revision",
      });

      const result = await node(state);

      // Should clear pending to trigger regeneration
      expect(result.pendingPrd).toBe("");
      // Should store feedback
      expect(result.userFeedback).toBe("Add more details about user authentication");
      // Should save pending as revision base (bug fix: enables feedback to be included in prompt)
      expect(result.prd).toBe("# PRD v1\n\nNeeds revision");
      // Phase should NOT change (stays at prd_review to loop back)
      expect(result.phase).toBeUndefined();
    });

    it("should throw on invalid interrupt response type", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue(123);

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState({
        pendingPrd: "# PRD v1",
      });

      await expect(node(state)).rejects.toThrow(
        "Invalid interrupt response: expected string feedback"
      );
    });

    it("should throw on null interrupt response", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue(null);

      const node = createPRDGeneratorNode(mockModel);
      const state = createBaseState({
        pendingPrd: "# PRD v1",
      });

      await expect(node(state)).rejects.toThrow(
        "Invalid interrupt response: expected string feedback"
      );
    });
  });

  describe("Document Consistency (Bug Fix Verification)", () => {
    it("should NOT regenerate document when resuming from interrupt", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("approve");

      const node = createPRDGeneratorNode(mockModel);

      // Simulate the state after Phase 1 returned (pendingPrd is set)
      // This is the state that would be restored on resume
      const resumeState = createBaseState({
        pendingPrd: "# PRD v1 - The user reviewed THIS document",
      });

      const result = await node(resumeState);

      // The EXACT document from pendingPrd should be saved
      expect(result.prd).toBe("# PRD v1 - The user reviewed THIS document");

      // LLM should NOT be called - this is the key fix!
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("should regenerate document only when userFeedback triggers revision", async () => {
      mockInvoke.mockResolvedValue({
        content: "# PRD v2 - Revised based on feedback",
      });

      const node = createPRDGeneratorNode(mockModel);

      // Simulate state after feedback was processed (pendingPrd cleared, userFeedback set)
      const revisionState = createBaseState({
        pendingPrd: "", // Cleared to trigger regeneration
        userFeedback: "Add authentication details",
        prd: "", // Previous version cleared
      });

      const result = await node(revisionState);

      // Should generate new document
      expect(result.pendingPrd).toBe("# PRD v2 - Revised based on feedback");

      // LLM SHOULD be called for regeneration
      expect(mockInvoke).toHaveBeenCalled();
    });
  });
});
