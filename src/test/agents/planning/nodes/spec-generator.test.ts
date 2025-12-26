/**
 * Tests for the tech spec generator node.
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
import { createSpecGeneratorNode } from "../../../../agents/planning/nodes/spec-generator.js";
import { interrupt } from "@langchain/langgraph";

describe("Spec Generator Node", () => {
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
      phase: "spec_review",
      signals: null,
      codeContext: "",
      clarificationHistory: [],
      clarificationComplete: true,
      pendingQuestions: [],
      pendingPrd: "",
      pendingTechSpec: "",
      prd: "# Approved PRD\n\nProduct requirements...",
      techSpec: "",
      taskPrompts: "",
      userFeedback: "",
      messages: [],
      ...overrides,
    }) as PlanningStateType;

  describe("Phase 1: Document Generation", () => {
    it("should generate tech spec and store in pendingTechSpec without interrupting", async () => {
      mockInvoke.mockResolvedValue({
        content: "# Technical Specification\n\nGenerated spec content",
      });

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState();

      const result = await node(state);

      // Should store in pendingTechSpec, NOT in techSpec
      expect(result.pendingTechSpec).toBe("# Technical Specification\n\nGenerated spec content");
      expect(result.techSpec).toBeUndefined();

      // Should NOT call interrupt in Phase 1
      expect(interrupt).not.toHaveBeenCalled();
    });

    it("should clear userFeedback after regeneration", async () => {
      mockInvoke.mockResolvedValue({
        content: "Revised spec content",
      });

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState({
        userFeedback: "Add more details about API design",
      });

      const result = await node(state);

      expect(result.userFeedback).toBe("");
    });
  });

  describe("Phase 2: Interrupt for Review", () => {
    it("should interrupt with pendingTechSpec when it exists", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("approve");

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState({
        pendingTechSpec: "# Tech Spec v1\n\nPending for review",
      });

      await node(state);

      // Should call interrupt with the pending document
      expect(mockedInterrupt).toHaveBeenCalledWith({
        type: "spec_review",
        document: "# Tech Spec v1\n\nPending for review",
        instructions:
          "Review the technical specification. Reply 'approve' to continue or provide feedback for revision.",
      });

      // Should NOT call LLM when we have a pending document
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("should move pendingTechSpec to techSpec on approval", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("approve");

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState({
        pendingTechSpec: "# Tech Spec v1\n\nApproved content",
      });

      const result = await node(state);

      // Should move pending to final
      expect(result.techSpec).toBe("# Tech Spec v1\n\nApproved content");
      expect(result.pendingTechSpec).toBe("");
      expect(result.phase).toBe("complete");
      expect(result.userFeedback).toBe("");
    });

    it("should handle case-insensitive approval", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("APPROVE");

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState({
        pendingTechSpec: "# Tech Spec v1",
      });

      const result = await node(state);

      expect(result.techSpec).toBe("# Tech Spec v1");
      expect(result.phase).toBe("complete");
    });

    it("should handle approval with whitespace", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("  approve  ");

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState({
        pendingTechSpec: "# Tech Spec v1",
      });

      const result = await node(state);

      expect(result.techSpec).toBe("# Tech Spec v1");
      expect(result.phase).toBe("complete");
    });

    it("should clear pendingTechSpec and store feedback for revision", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue("Add more details about error handling");

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState({
        pendingTechSpec: "# Tech Spec v1\n\nNeeds revision",
      });

      const result = await node(state);

      // Should clear pending to trigger regeneration
      expect(result.pendingTechSpec).toBe("");
      // Should store feedback
      expect(result.userFeedback).toBe("Add more details about error handling");
      // Should NOT update final techSpec
      expect(result.techSpec).toBeUndefined();
      // Phase should NOT change (stays at spec_review to loop back)
      expect(result.phase).toBeUndefined();
    });

    it("should throw on invalid interrupt response type", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue({ invalid: "object" });

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState({
        pendingTechSpec: "# Tech Spec v1",
      });

      await expect(node(state)).rejects.toThrow(
        "Invalid interrupt response: expected string feedback"
      );
    });

    it("should throw on null interrupt response", async () => {
      const mockedInterrupt = vi.mocked(interrupt);
      mockedInterrupt.mockReturnValue(null);

      const node = createSpecGeneratorNode(mockModel);
      const state = createBaseState({
        pendingTechSpec: "# Tech Spec v1",
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

      const node = createSpecGeneratorNode(mockModel);

      // Simulate the state after Phase 1 returned (pendingTechSpec is set)
      // This is the state that would be restored on resume
      const resumeState = createBaseState({
        pendingTechSpec: "# Tech Spec v1 - The user reviewed THIS document",
      });

      const result = await node(resumeState);

      // The EXACT document from pendingTechSpec should be saved
      expect(result.techSpec).toBe("# Tech Spec v1 - The user reviewed THIS document");

      // LLM should NOT be called - this is the key fix!
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("should regenerate document only when userFeedback triggers revision", async () => {
      mockInvoke.mockResolvedValue({
        content: "# Tech Spec v2 - Revised based on feedback",
      });

      const node = createSpecGeneratorNode(mockModel);

      // Simulate state after feedback was processed (pendingTechSpec cleared, userFeedback set)
      const revisionState = createBaseState({
        pendingTechSpec: "", // Cleared to trigger regeneration
        userFeedback: "Add caching strategy details",
        techSpec: "", // Previous version cleared
      });

      const result = await node(revisionState);

      // Should generate new document
      expect(result.pendingTechSpec).toBe("# Tech Spec v2 - Revised based on feedback");

      // LLM SHOULD be called for regeneration
      expect(mockInvoke).toHaveBeenCalled();
    });
  });
});
