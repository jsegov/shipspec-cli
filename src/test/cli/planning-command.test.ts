/**
 * Tests for planning CLI command.
 */

import { describe, it, expect, vi } from "vitest";

// Mock @inquirer/prompts to avoid import issues in tests
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
}));

import { planningCommand } from "../../cli/commands/planning.js";

describe("planningCommand", () => {
  it("should be defined with correct name", () => {
    expect(planningCommand).toBeDefined();
    expect(planningCommand.name()).toBe("planning");
  });

  it("should have correct description", () => {
    const description = planningCommand.description();
    expect(description).toContain("spec-driven development");
  });

  it("should accept optional idea argument", () => {
    const args = planningCommand.registeredArguments;
    expect(args).toHaveLength(1);
    const firstArg = args[0];
    expect(firstArg).toBeDefined();
    expect(firstArg?.name()).toBe("idea");
    expect(firstArg?.required).toBe(false);
  });

  it("should have expected options", () => {
    const options = planningCommand.options;
    const optionNames = options.map((opt) => opt.long);

    expect(optionNames).toContain("--track");
    expect(optionNames).toContain("--reindex");
    expect(optionNames).toContain("--no-save");
    expect(optionNames).toContain("--cloud-ok");
    expect(optionNames).toContain("--local-only");
  });
});
