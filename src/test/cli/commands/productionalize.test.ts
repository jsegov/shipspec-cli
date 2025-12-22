import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { productionalizeCommand } from "../../../cli/commands/productionalize.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { join } from "path";
import { existsSync } from "fs";
import { PROJECT_DIR, writeProjectState } from "../../../core/project/project-state.js";
import { randomUUID } from "crypto";

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
  createEmbeddingsModel: vi.fn().mockResolvedValue({}),
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

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);
    vi.clearAllMocks();

    // Set up commander to not exit
    productionalizeCommand.exitOverride();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  });

  it("should fail if not initialized", async () => {
    await expect(productionalizeCommand.parseAsync(["node", "test"])).rejects.toThrow(
      /directory has not been initialized/
    );
  });

  it("should fail if OpenAI API key is missing from keychain", async () => {
    // Initialize
    await writeProjectState(tempDir, {
      schemaVersion: 1,
      projectId: randomUUID(),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot: tempDir,
    });

    mockSecrets.get.mockResolvedValue(null); // No key

    await expect(productionalizeCommand.parseAsync(["node", "test"])).rejects.toThrow(
      /OpenAI API key not found/
    );
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
      if (key === "OPENAI_API_KEY") return Promise.resolve("sk-test");
      if (key === "TAVILY_API_KEY") return Promise.resolve("tvly-test");
      return Promise.resolve(null);
    });

    await productionalizeCommand.parseAsync(["node", "test", "--no-stream"]);

    const shipSpecDir = join(tempDir, PROJECT_DIR);
    const outputsDir = join(shipSpecDir, "outputs");

    expect(existsSync(outputsDir)).toBe(true);
    expect(existsSync(join(shipSpecDir, "latest-report.md"))).toBe(true);
    expect(existsSync(join(shipSpecDir, "latest-task-prompts.md"))).toBe(true);
  });
});
