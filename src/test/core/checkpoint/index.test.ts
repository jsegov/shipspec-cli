import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCheckpointer } from "../../../core/checkpoint/index.js";

// Mock the checkpoint modules
vi.mock("@langchain/langgraph-checkpoint", () => {
  class MockMemorySaver {
    type = "memory";
  }
  return {
    MemorySaver: MockMemorySaver,
  };
});

vi.mock("@langchain/langgraph-checkpoint-sqlite", () => ({
  SqliteSaver: {
    fromConnString: vi.fn().mockImplementation((path: string) => ({
      type: "sqlite",
      path,
    })),
  },
}));

describe("Checkpoint Factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createCheckpointer", () => {
    it("creates MemorySaver when type is 'memory'", async () => {
      const checkpointer = await createCheckpointer("memory");

      expect(checkpointer).toBeDefined();
      expect(checkpointer).toHaveProperty("type", "memory");
    });

    it("creates SqliteSaver when type is 'sqlite' with path", async () => {
      const dbPath = "/tmp/test-checkpoint.db";
      const checkpointer = await createCheckpointer("sqlite", dbPath);

      expect(checkpointer).toBeDefined();
      expect(checkpointer).toHaveProperty("type", "sqlite");
      expect(checkpointer).toHaveProperty("path", dbPath);
    });

    it("throws error when sqlite type but no path provided", async () => {
      await expect(createCheckpointer("sqlite")).rejects.toThrow(
        "SQLite checkpointer requires a database path"
      );
    });

    it("defaults to MemorySaver when type is 'memory' regardless of path", async () => {
      const checkpointer = await createCheckpointer("memory", "/some/path.db");

      expect(checkpointer).toBeDefined();
      expect(checkpointer).toHaveProperty("type", "memory");
    });
  });
});

