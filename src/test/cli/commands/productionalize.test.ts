import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { productionalizeCommand } from "../../../cli/commands/productionalize.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { join } from "path";
import { existsSync } from "fs";
import { PROJECT_DIR, writeProjectState } from "../../../core/project/project-state.js";
import { randomUUID } from "crypto";

// Mock @inquirer/prompts to avoid node:util styleText import error
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn().mockResolvedValue("mock input"),
  select: vi.fn().mockResolvedValue("mock selection"),
  checkbox: vi.fn().mockResolvedValue([]),
}));

// Mock dependencies
vi.mock("../../../agents/productionalize/graph.js", () => ({
  createProductionalizeGraph: vi.fn().mockResolvedValue({
    invoke: vi.fn().mockResolvedValue({
      finalReport: "# Mock Report",
      taskPrompts: "### Task 1:\n```\nMock prompt\n```",
    }),
  }),
}));

vi.mock("../../../core/storage/vector-store.js", () => ({
  LanceDBManager: class {
    dropTable = vi.fn();
  },
}));

vi.mock("../../../core/models/embeddings.js", () => ({
  createEmbeddingsModel: vi.fn().mockResolvedValue({
    embedQuery: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  }),
}));

vi.mock("../../../core/storage/repository.js", () => ({
  DocumentRepository: class {
    dummy = true;
  },
}));

vi.mock("../../../core/indexing/ensure-index.js", () => ({
  ensureIndex: vi.fn().mockResolvedValue({ added: 0, modified: 0, removed: 0 }),
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

describe("Productionalize CLI Command", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalOpenrouterKey: string | undefined;

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
    originalOpenrouterKey = process.env.OPENROUTER_API_KEY;
    process.chdir(tempDir);
    vi.clearAllMocks();

    // Set up commander to not exit
    productionalizeCommand.exitOverride();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupTempDir(tempDir);

    // Restore or delete OPENROUTER_API_KEY to prevent env leakage
    if (originalOpenrouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenrouterKey;
    }
  });

  it("should fail if not initialized", async () => {
    await expect(productionalizeCommand.parseAsync(["node", "test"])).rejects.toThrow(
      /directory has not been initialized/
    );
  });

  it("should fail if OpenRouter API key is missing from both env and keychain", async () => {
    // Initialize
    await writeProjectState(tempDir, {
      schemaVersion: 1,
      projectId: randomUUID(),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot: tempDir,
    });

    mockSecrets.get.mockResolvedValue(null); // No key in keychain
    // No key in env either (default state)

    await expect(productionalizeCommand.parseAsync(["node", "test"])).rejects.toThrow(
      /OpenRouter API key not found/
    );
  });

  it("should succeed with API key from environment variable (no keychain needed)", async () => {
    // Initialize
    await writeProjectState(tempDir, {
      schemaVersion: 1,
      projectId: randomUUID(),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot: tempDir,
    });

    // Set API key via environment variable
    process.env.OPENROUTER_API_KEY = "sk-env-test-key";

    mockSecrets.get.mockResolvedValue(null); // No key in keychain

    await productionalizeCommand.parseAsync(["node", "test", "--no-stream", "--cloud-ok"]);

    const shipSpecDir = join(tempDir, PROJECT_DIR);
    const outputsDir = join(shipSpecDir, "outputs");

    expect(existsSync(outputsDir)).toBe(true);
    expect(existsSync(join(shipSpecDir, "latest-report.md"))).toBe(true);
  });

  it("should run analysis and write output to .ship-spec/outputs/", async () => {
    // Initialize
    await writeProjectState(tempDir, {
      schemaVersion: 1,
      projectId: randomUUID(),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot: tempDir,
    });

    mockSecrets.get.mockImplementation((key) => {
      if (key === "OPENROUTER_API_KEY") return Promise.resolve("sk-test");
      if (key === "TAVILY_API_KEY") return Promise.resolve("tvly-test");
      return Promise.resolve(null);
    });

    await productionalizeCommand.parseAsync(["node", "test", "--no-stream", "--cloud-ok"]);

    const shipSpecDir = join(tempDir, PROJECT_DIR);
    const outputsDir = join(shipSpecDir, "outputs");

    expect(existsSync(outputsDir)).toBe(true);
    expect(existsSync(join(shipSpecDir, "latest-report.md"))).toBe(true);
    expect(existsSync(join(shipSpecDir, "latest-task-prompts.md"))).toBe(true);
  });

  describe("interrupt handling", () => {
    it("should throw CliRuntimeError for unexpected interrupt type (prevents infinite loop)", async () => {
      // Initialize
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      mockSecrets.get.mockImplementation((key) => {
        if (key === "OPENROUTER_API_KEY") return Promise.resolve("sk-test");
        return Promise.resolve(null);
      });

      // Import the mock to override it for this test
      const graphModule = await import("../../../agents/productionalize/graph.js");
      const createProductionalizeGraph = vi.mocked(graphModule.createProductionalizeGraph);

      // Mock to return an unexpected interrupt type
      // We intentionally use an invalid type to test the default case handler.
      // Cast through unknown to satisfy TypeScript while testing runtime behavior.
      const mockInvokeFn = vi.fn().mockResolvedValue({
        finalReport: "",
        taskPrompts: "",
        __interrupt__: [
          {
            id: "test-interrupt",
            value: {
              type: "unknown_type_that_does_not_exist", // This should trigger the default case
            },
          },
        ],
      });
      const mockGraph = { invoke: mockInvokeFn } as unknown as Awaited<
        ReturnType<typeof createProductionalizeGraph>
      >;
      createProductionalizeGraph.mockResolvedValueOnce(mockGraph);

      // Interactive mode is the default, so no need to explicitly enable it
      // The error is wrapped by CliRuntimeError("Analysis failed", originalError)
      // so we need to verify both the wrapper and the cause
      try {
        await productionalizeCommand.parseAsync(["node", "test", "--cloud-ok"]);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const error = err as Error & { originalError?: Error };
        expect(error.message).toBe("Analysis failed");
        // Verify the original error contains the expected message about unhandled interrupt type
        expect(error.originalError).toBeDefined();
        expect(error.originalError?.message).toMatch(
          /Unhandled interrupt type: "unknown_type_that_does_not_exist"/
        );
      }
    });
  });

  describe("--keep-outputs validation", () => {
    it("should reject --keep-outputs 0 to prevent deleting all historical outputs", async () => {
      await expect(
        productionalizeCommand.parseAsync(["node", "test", "--keep-outputs", "0"])
      ).rejects.toThrow(/--keep-outputs must be at least 1/);
    });

    it("should reject negative --keep-outputs values", async () => {
      await expect(
        productionalizeCommand.parseAsync(["node", "test", "--keep-outputs", "-1"])
      ).rejects.toThrow(/--keep-outputs must be at least 1/);

      await expect(
        productionalizeCommand.parseAsync(["node", "test", "--keep-outputs", "-5"])
      ).rejects.toThrow(/--keep-outputs must be at least 1/);
    });

    it("should reject non-numeric --keep-outputs values", async () => {
      await expect(
        productionalizeCommand.parseAsync(["node", "test", "--keep-outputs", "abc"])
      ).rejects.toThrow(/--keep-outputs must be a valid number/);

      await expect(
        productionalizeCommand.parseAsync(["node", "test", "--keep-outputs", ""])
      ).rejects.toThrow(/--keep-outputs must be a valid number/);
    });

    it("should accept valid positive --keep-outputs values", async () => {
      // Initialize first so we can pass the initialization check
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      mockSecrets.get.mockImplementation((key) => {
        if (key === "OPENROUTER_API_KEY") return Promise.resolve("sk-test");
        return Promise.resolve(null);
      });

      // Should not throw for valid values (will fail later for other reasons if not fully mocked)
      await productionalizeCommand.parseAsync([
        "node",
        "test",
        "--keep-outputs",
        "5",
        "--no-stream",
        "--cloud-ok",
      ]);

      // If we get here, the validation passed
      expect(true).toBe(true);
    });
  });
});
