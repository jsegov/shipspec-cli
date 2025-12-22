import { describe, it, expect, vi } from "vitest";
import { createPromptGeneratorNode } from "../../../../agents/productionalize/nodes/prompt-generator.js";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProductionalizeStateType } from "../../../../agents/productionalize/state.js";

describe("Prompt Generator Node", () => {
  it("should generate a list of prompts in markdown format", async () => {
    const mockOutput = {
      prompts: [
        {
          id: 1,
          prompt: "Fix vulnerability by adding auth middleware",
        },
        {
          id: 2,
          prompt: "Harden gh actions by adding scanners",
        },
      ],
    };
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(mockOutput),
      }),
    } as unknown as BaseChatModel;

    const node = createPromptGeneratorNode(mockModel);
    const state = {
      findings: [],
      signals: {},
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.taskPrompts).toContain("### Task 1:");
    expect(result.taskPrompts).toContain("Fix vulnerability by adding auth middleware");
    expect(result.taskPrompts).toContain("### Task 2:");
    expect(result.taskPrompts).toContain("Harden gh actions by adding scanners");
    expect(result.taskPrompts).toContain("```");
  });

  it("should handle empty prompts list gracefully", async () => {
    const mockOutput = {
      prompts: [],
    };
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue(mockOutput),
      }),
    } as unknown as BaseChatModel;

    const node = createPromptGeneratorNode(mockModel);
    const state = {
      findings: [],
      signals: {},
    } as unknown as ProductionalizeStateType;

    const result = await node(state);

    expect(result.taskPrompts).toBe("");
  });
});
