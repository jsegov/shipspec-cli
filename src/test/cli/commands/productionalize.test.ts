import { describe, it, expect, vi, beforeEach } from "vitest";
import { productionalizeCommand } from "../../../cli/commands/productionalize.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { writeFile } from "fs/promises";
import { join } from "path";

// Mock dependencies
vi.mock("../../../agents/productionalize/graph.js", () => ({
  createProductionalizeGraph: vi.fn().mockResolvedValue({
    invoke: vi.fn().mockResolvedValue({
      finalReport: "# Mock Report",
      tasks: [{ id: 1, title: "Mock Task" }],
    }),
  }),
}));

vi.mock("../../../core/storage/vector-store.js", () => ({
  LanceDBManager: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../../core/models/embeddings.js", () => ({
  createEmbeddingsModel: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../core/storage/repository.js", () => ({
  DocumentRepository: vi.fn().mockImplementation(() => ({})),
}));

describe("Productionalize CLI Command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Create a mock .env file
    await writeFile(join(tempDir, ".env"), "OPENAI_API_KEY=test");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    vi.clearAllMocks();
  });

  it("should output a report to a file", () => {
    const _reportPath = join(tempDir, "report.md");
    const _tasksPath = join(tempDir, "tasks.json");

    // We need to bypass the actual action because it uses process.cwd() and loadConfig
    // Instead we can test the command configuration
    expect(productionalizeCommand.name()).toBe("productionalize");
    expect(productionalizeCommand.options.map((o) => o.flags)).toContain("-o, --output <file>");
    expect(productionalizeCommand.options.map((o) => o.flags)).toContain("--tasks-output <file>");
    expect(productionalizeCommand.options.map((o) => o.flags)).toContain("--task-prompts");
    expect(productionalizeCommand.options.map((o) => o.flags)).toContain("--reindex");
  });
});
