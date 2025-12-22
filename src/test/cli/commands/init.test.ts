import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initCommand } from "../../../cli/commands/init.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { join } from "path";
import { realpath, readFile } from "fs/promises";
import { existsSync } from "fs";

// Mock @inquirer/prompts
vi.mock("@inquirer/prompts", () => ({
  password: vi.fn(),
  confirm: vi.fn(),
}));

// Mock secrets store
const mockSecrets = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock("../../../core/secrets/secrets-store.js", () => ({
  createSecretsStore: () => mockSecrets,
}));

interface MockInquirer {
  password: {
    mockResolvedValueOnce: (v: string) => void;
  };
  confirm: {
    mockResolvedValue: (v: boolean) => void;
  };
}

describe("initCommand", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);
    vi.clearAllMocks();
    initCommand.exitOverride();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  });

  it("should initialize a project in interactive mode", async () => {
    const inquirer = (await import("@inquirer/prompts")) as unknown as MockInquirer;

    inquirer.confirm.mockResolvedValue(true);
    inquirer.password.mockResolvedValueOnce("sk-test-openai");
    inquirer.password.mockResolvedValueOnce("tvly-test-tavily");
    mockSecrets.get.mockResolvedValue(null);

    // Call parseAsync with no extra arguments
    await initCommand.parseAsync(["node", "test"]);

    const projectFilePath = join(tempDir, ".ship-spec", "project.json");
    expect(existsSync(projectFilePath)).toBe(true);

    const content = await readFile(projectFilePath, "utf-8");
    const projectState = JSON.parse(content) as { projectRoot: string };

    // Use realpath to handle potential /private/var vs /var differences on macOS
    const resolvedRoot = await realpath(projectState.projectRoot);
    const resolvedTemp = await realpath(tempDir);
    expect(resolvedRoot).toBe(resolvedTemp);

    expect(mockSecrets.set).toHaveBeenCalledWith("OPENAI_API_KEY", "sk-test-openai");
    expect(mockSecrets.set).toHaveBeenCalledWith("TAVILY_API_KEY", "tvly-test-tavily");
  });

  it("should initialize a project in non-interactive mode", async () => {
    process.env.OPENAI_API_KEY = "sk-env-openai";
    process.env.TAVILY_API_KEY = "tvly-env-tavily";

    await initCommand.parseAsync(["node", "test", "--non-interactive"]);

    const projectFilePath = join(tempDir, ".ship-spec", "project.json");
    expect(existsSync(projectFilePath)).toBe(true);

    expect(mockSecrets.set).toHaveBeenCalledWith("OPENAI_API_KEY", "sk-env-openai");
    expect(mockSecrets.set).toHaveBeenCalledWith("TAVILY_API_KEY", "tvly-env-tavily");

    delete process.env.OPENAI_API_KEY;
    delete process.env.TAVILY_API_KEY;
  });

  it("should fail in non-interactive mode if keys are missing", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(initCommand.parseAsync(["node", "test", "--non-interactive"])).rejects.toThrow();
  });
});
