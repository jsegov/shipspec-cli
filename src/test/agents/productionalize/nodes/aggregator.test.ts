import { describe, it, expect, vi } from "vitest";
import { createAggregatorNode } from "../../../../agents/productionalize/nodes/aggregator.js";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";
import type { HumanMessage } from "@langchain/core/messages";

describe("Aggregator Node", () => {
  it("should synthesize a final report", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ content: "# Final Report" });
    const mockModel = {
      invoke: mockInvoke,
    } as unknown as BaseChatModel;

    const node = createAggregatorNode(mockModel);
    const state = {
      findings: [],
      signals: {},
      researchDigest: "test digest",
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.finalReport).toBe("# Final Report");
    expect(mockInvoke).toHaveBeenCalled();
  });

  it("should incorporate user feedback even when finalReport is empty", async () => {
    // Regression test: feedback was silently ignored when finalReport was empty
    // because the condition was `if (hasUserFeedback && finalReport)`
    const mockInvoke = vi.fn().mockResolvedValue({ content: "# Regenerated Report" });
    const mockModel = {
      invoke: mockInvoke,
    } as unknown as BaseChatModel;

    const node = createAggregatorNode(mockModel);
    const state = {
      findings: [],
      signals: {},
      researchDigest: "test digest",
      reportFeedback: "Please add more security details",
      finalReport: "", // Empty report - the bug would ignore feedback in this case
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.finalReport).toBe("# Regenerated Report");
    expect(mockInvoke).toHaveBeenCalled();

    // Verify that the prompt includes the user feedback
    const invokeCall = mockInvoke.mock.calls[0] as [unknown[]];
    const messages = invokeCall[0];
    const humanMessage = messages[1] as HumanMessage;
    const promptContent = humanMessage.content as string;

    expect(promptContent).toContain("## User Feedback");
    expect(promptContent).toContain("Please add more security details");
    expect(promptContent).toContain("Regenerate the Production Readiness Report");
    // Should not include "Previous Report" section when finalReport is empty
    expect(promptContent).not.toContain("## Previous Report");
  });

  it("should include both previous report and feedback when both exist", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ content: "# Updated Report" });
    const mockModel = {
      invoke: mockInvoke,
    } as unknown as BaseChatModel;

    const node = createAggregatorNode(mockModel);
    const state = {
      findings: [],
      signals: {},
      researchDigest: "test digest",
      reportFeedback: "Please add more security details",
      finalReport: "# Original Report\n\nSome content here",
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.finalReport).toBe("# Updated Report");

    // Verify that the prompt includes both the previous report and feedback
    const invokeCall = mockInvoke.mock.calls[0] as [unknown[]];
    const messages = invokeCall[0];
    const humanMessage = messages[1] as HumanMessage;
    const promptContent = humanMessage.content as string;

    expect(promptContent).toContain("## Previous Report");
    expect(promptContent).toContain("# Original Report");
    expect(promptContent).toContain("## User Feedback");
    expect(promptContent).toContain("Please add more security details");
    expect(promptContent).toContain("Maintain the same structure");
  });
});
