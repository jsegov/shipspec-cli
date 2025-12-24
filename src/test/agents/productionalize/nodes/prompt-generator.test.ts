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

  it("should handle shouldRedact=true with large payloads without breaking JSON structure", async () => {
    // Regression test: Previously, redactText() would truncate large JSON strings
    // with "\n[... truncated for security]", breaking JSON.parse()
    const mockOutput = {
      prompts: [{ id: 1, prompt: "Test prompt" }],
    };
    const mockInvoke = vi.fn().mockResolvedValue(mockOutput);
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: mockInvoke,
      }),
    } as unknown as BaseChatModel;

    // Create large findings that exceed 50KB when serialized
    const largeContent = "x".repeat(60000);
    const state = {
      findings: [
        {
          category: "security",
          summary: largeContent,
          priority: "high" as const,
          lineItems: [],
        },
      ],
      signals: {
        techStack: { languages: [], frameworks: [], buildTools: [] },
        hasCI: false,
        hasTests: false,
        hasDocs: false,
        hasLockfile: false,
        secretsInCode: [],
        envFiles: [],
        configFiles: [],
        entryPoints: [],
        totalFiles: 1,
        totalLines: 1,
      },
    } as unknown as ProductionalizeStateType;

    const node = createPromptGeneratorNode(mockModel, true);

    // Should not throw due to JSON.parse() error
    await expect(node(state)).resolves.not.toThrow();

    // Verify the model was invoked (meaning redaction succeeded)
    expect(mockInvoke).toHaveBeenCalled();
  });

  it("should redact sensitive property names when shouldRedact=true", async () => {
    const mockOutput = {
      prompts: [{ id: 1, prompt: "Test prompt" }],
    };
    const mockInvoke = vi.fn().mockResolvedValue(mockOutput);
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: mockInvoke,
      }),
    } as unknown as BaseChatModel;

    // Use API_KEY (uppercase with underscore) which matches SENSITIVE_NAMES pattern
    // and a secret format that matches the SECRET_PATTERNS (sk- followed by 20+ alphanumeric)
    const secretValue = "sk-abcdefghij1234567890abcdefghij";
    const state = {
      findings: [
        {
          category: "security",
          summary: "Found hardcoded secret",
          priority: "high" as const,
          lineItems: [],
        },
      ],
      signals: {
        techStack: { languages: [], frameworks: [], buildTools: [] },
        hasCI: false,
        hasTests: false,
        hasDocs: false,
        hasLockfile: false,
        secretsInCode: [secretValue],
        envFiles: [],
        configFiles: [],
        entryPoints: [],
        totalFiles: 1,
        totalLines: 1,
        API_KEY: secretValue, // Uses underscore format to match SENSITIVE_NAMES
      },
    } as unknown as ProductionalizeStateType;

    const node = createPromptGeneratorNode(mockModel, true);
    await node(state);

    // Check that the invoke was called with redacted content
    const invokeCall = mockInvoke.mock.calls[0];
    expect(invokeCall).toBeDefined();
    const messages = invokeCall?.[0] as { content: string }[];
    const userMessage = messages[1];
    const content = userMessage?.content ?? "";

    // Sensitive property 'API_KEY' should be redacted by name
    expect(content).toContain('"API_KEY": "[REDACTED]"');
    // The secret value in secretsInCode array should be redacted by pattern
    expect(content).not.toContain(secretValue);
  });
});
