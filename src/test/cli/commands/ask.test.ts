import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { askCommand } from "../../../cli/commands/ask.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { writeProjectState, PROJECT_DIR } from "../../../core/project/project-state.js";
import { randomUUID } from "crypto";

// Mock @inquirer/prompts
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
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

// Mock LanceDBManager
vi.mock("../../../core/storage/vector-store.js", () => ({
  LanceDBManager: class {
    dropTable = vi.fn();
  },
}));

// Mock embeddings model
vi.mock("../../../core/models/embeddings.js", () => ({
  createEmbeddingsModel: vi.fn().mockResolvedValue({
    embedQuery: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
    embedDocuments: vi.fn().mockResolvedValue([new Array(1024).fill(0)]),
  }),
}));

// Mock DocumentRepository - use a factory that returns a class with mockable methods
vi.mock("../../../core/storage/repository.js", () => {
  const mockHybridSearch = vi.fn();
  return {
    DocumentRepository: class {
      hybridSearch = mockHybridSearch;
      static getMock = () => mockHybridSearch;
    },
  };
});

// Mock ensureIndex
vi.mock("../../../core/indexing/ensure-index.js", () => ({
  ensureIndex: vi.fn().mockResolvedValue({ added: 0, modified: 0, removed: 0 }),
}));

// Mock chat model with streaming - return a promise that resolves to an object with stream
vi.mock("../../../core/models/llm.js", () => {
  const mockStream = vi.fn();
  return {
    createChatModel: vi.fn().mockResolvedValue({
      stream: mockStream,
    }),
    getMockStream: () => mockStream,
  };
});

describe("askCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalOpenrouterKey: string | undefined;

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
    originalOpenrouterKey = process.env.OPENROUTER_API_KEY;
    process.chdir(tempDir);
    vi.clearAllMocks();
    askCommand.exitOverride();
  });

  afterEach(async () => {
    if (originalOpenrouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenrouterKey;
    }

    process.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  });

  describe("command definition", () => {
    it("should be defined with correct name", () => {
      expect(askCommand).toBeDefined();
      expect(askCommand.name()).toBe("ask");
    });

    it("should accept optional question argument", () => {
      const args = askCommand.registeredArguments;
      expect(args).toHaveLength(1);
      const firstArg = args[0];
      expect(firstArg?.name()).toBe("question");
      expect(firstArg?.required).toBe(false);
    });

    it("should have expected options", () => {
      const options = askCommand.options;
      const optionNames = options.map((opt) => opt.long);
      expect(optionNames).toContain("--reindex");
      expect(optionNames).toContain("--cloud-ok");
      expect(optionNames).toContain("--local-only");
    });
  });

  describe("initialization checks", () => {
    it("should fail if not initialized", async () => {
      await expect(askCommand.parseAsync(["node", "test", "What is this code?"])).rejects.toThrow(
        /directory has not been initialized/
      );
    });

    it("should fail if API key is missing", async () => {
      // Initialize project
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      mockSecrets.get.mockResolvedValue(null);

      await expect(askCommand.parseAsync(["node", "test", "What is this code?"])).rejects.toThrow(
        /OpenRouter API key not found/
      );
    });

    it("should create index automatically when lancedb directory does not exist", async () => {
      // Initialize project
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      // Set API key
      process.env.OPENROUTER_API_KEY = "sk-test";

      // Mock hybridSearch to return results (the command should proceed to search)
      const { DocumentRepository } = await import("../../../core/storage/repository.js");
      const mockHybridSearch = (
        DocumentRepository as unknown as { getMock: () => ReturnType<typeof vi.fn> }
      ).getMock();
      mockHybridSearch.mockResolvedValue([
        {
          id: "test-chunk",
          content: "test content",
          filepath: "test.ts",
          startLine: 1,
          endLine: 10,
          language: "typescript",
          type: "module",
        },
      ]);

      // Mock the chat model stream to return content
      const llmModule = await import("../../../core/models/llm.js");
      const mockStream = (
        llmModule as unknown as { getMockStream: () => ReturnType<typeof vi.fn> }
      ).getMockStream();
      mockStream.mockImplementation(async function* () {
        await Promise.resolve();
        yield { content: "Test answer" };
      });

      // Don't create vectorDbPath - the command should create it automatically
      // This should succeed (index created on demand, like productionalize)
      await askCommand.parseAsync(["node", "test", "What is this code?", "--cloud-ok"]);

      // Verify that ensureIndex was called (meaning the index was created)
      const { ensureIndex } = await import("../../../core/indexing/ensure-index.js");
      expect(ensureIndex).toHaveBeenCalled();
    });
  });

  describe("cloud consent", () => {
    it("should require --cloud-ok for cloud providers", async () => {
      // Initialize project with lancedb
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      await expect(askCommand.parseAsync(["node", "test", "What is this code?"])).rejects.toThrow(
        /Data sharing consent required/
      );
    });

    it("should proceed with --cloud-ok flag", async () => {
      // Initialize project with lancedb
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Setup mocks for this test
      const { DocumentRepository } = await import("../../../core/storage/repository.js");
      const mockHybridSearch = (
        DocumentRepository as unknown as { getMock: () => ReturnType<typeof vi.fn> }
      ).getMock();
      mockHybridSearch.mockResolvedValue([
        {
          id: "chunk1",
          content: "function add(a, b) { return a + b; }",
          filepath: "src/utils/math.ts",
          startLine: 10,
          endLine: 12,
          language: "typescript",
          type: "function",
          symbolName: "add",
        },
      ]);

      const llmModule = await import("../../../core/models/llm.js");
      const mockStream = (
        llmModule as unknown as { getMockStream: () => ReturnType<typeof vi.fn> }
      ).getMockStream();
      mockStream.mockImplementation(async function* () {
        await Promise.resolve();
        yield { content: "Test response" };
      });

      // Should not throw with --cloud-ok
      await expect(
        askCommand.parseAsync(["node", "test", "What is this code?", "--cloud-ok"])
      ).resolves.not.toThrow();
    });

    it("should respect saved consent", async () => {
      // Initialize project with lancedb and consent
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      // Write consent file
      const consentPath = join(tempDir, PROJECT_DIR, "consent.json");
      await writeFile(
        consentPath,
        JSON.stringify({ cloudOk: true, timestamp: new Date().toISOString(), version: 1 })
      );

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Setup mocks
      const { DocumentRepository } = await import("../../../core/storage/repository.js");
      const mockHybridSearch = (
        DocumentRepository as unknown as { getMock: () => ReturnType<typeof vi.fn> }
      ).getMock();
      mockHybridSearch.mockResolvedValue([
        {
          id: "chunk1",
          content: "function add(a, b) { return a + b; }",
          filepath: "src/utils/math.ts",
          startLine: 10,
          endLine: 12,
          language: "typescript",
          type: "function",
          symbolName: "add",
        },
      ]);

      const llmModule = await import("../../../core/models/llm.js");
      const mockStream = (
        llmModule as unknown as { getMockStream: () => ReturnType<typeof vi.fn> }
      ).getMockStream();
      mockStream.mockImplementation(async function* () {
        await Promise.resolve();
        yield { content: "Test response" };
      });

      // Should not throw without --cloud-ok when consent is saved
      await expect(
        askCommand.parseAsync(["node", "test", "What is this code?"])
      ).resolves.not.toThrow();
    });
  });

  describe("single question mode", () => {
    it("should handle a single question and stream response", async () => {
      // Setup
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Setup mocks
      const { DocumentRepository } = await import("../../../core/storage/repository.js");
      const mockHybridSearch = (
        DocumentRepository as unknown as { getMock: () => ReturnType<typeof vi.fn> }
      ).getMock();
      mockHybridSearch.mockResolvedValue([
        {
          id: "chunk1",
          content: "function add(a, b) { return a + b; }",
          filepath: "src/utils/math.ts",
          startLine: 10,
          endLine: 12,
          language: "typescript",
          type: "function",
          symbolName: "add",
        },
      ]);

      const llmModule = await import("../../../core/models/llm.js");
      const mockStream = (
        llmModule as unknown as { getMockStream: () => ReturnType<typeof vi.fn> }
      ).getMockStream();
      mockStream.mockImplementation(async function* () {
        await Promise.resolve();
        yield { content: "The " };
        yield { content: "add " };
        yield { content: "function adds two numbers." };
      });

      await askCommand.parseAsync(["node", "test", "What does the add function do?", "--cloud-ok"]);

      // Verify hybrid search was called
      expect(mockHybridSearch).toHaveBeenCalledWith("What does the add function do?", 10);

      // Verify stream was called
      expect(mockStream).toHaveBeenCalled();
    });

    it("should handle no search results gracefully", async () => {
      // Setup
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Return empty results
      const { DocumentRepository } = await import("../../../core/storage/repository.js");
      const mockHybridSearch = (
        DocumentRepository as unknown as { getMock: () => ReturnType<typeof vi.fn> }
      ).getMock();
      mockHybridSearch.mockResolvedValue([]);

      const llmModule = await import("../../../core/models/llm.js");
      const mockStream = (
        llmModule as unknown as { getMockStream: () => ReturnType<typeof vi.fn> }
      ).getMockStream();

      await askCommand.parseAsync([
        "node",
        "test",
        "What about something that doesn't exist?",
        "--cloud-ok",
      ]);

      // Stream should not be called when no results
      expect(mockStream).not.toHaveBeenCalled();
    });
  });

  describe("REPL mode", () => {
    it("should handle /exit command", async () => {
      const { input } = await import("@inquirer/prompts");
      const mockInput = vi.mocked(input);

      // Setup
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Simulate user typing /exit
      mockInput.mockResolvedValueOnce("/exit");

      await askCommand.parseAsync(["node", "test", "--cloud-ok"]);

      expect(mockInput).toHaveBeenCalled();
    });

    it("should handle /quit command", async () => {
      const { input } = await import("@inquirer/prompts");
      const mockInput = vi.mocked(input);

      // Setup
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Simulate user typing /quit
      mockInput.mockResolvedValueOnce("/quit");

      await askCommand.parseAsync(["node", "test", "--cloud-ok"]);

      expect(mockInput).toHaveBeenCalled();
    });

    it("should handle /help command and continue", async () => {
      const { input } = await import("@inquirer/prompts");
      const mockInput = vi.mocked(input);

      // Setup
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Simulate user typing /help then /exit
      mockInput.mockResolvedValueOnce("/help").mockResolvedValueOnce("/exit");

      await askCommand.parseAsync(["node", "test", "--cloud-ok"]);

      // Input should be called twice (once for /help, once for /exit)
      expect(mockInput).toHaveBeenCalledTimes(2);
    });

    it("should handle /clear command and continue", async () => {
      const { input } = await import("@inquirer/prompts");
      const mockInput = vi.mocked(input);

      // Setup
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Simulate user typing /clear then /exit
      mockInput.mockResolvedValueOnce("/clear").mockResolvedValueOnce("/exit");

      await askCommand.parseAsync(["node", "test", "--cloud-ok"]);

      // Input should be called twice
      expect(mockInput).toHaveBeenCalledTimes(2);
    });

    it("should handle question and then exit", async () => {
      const { input } = await import("@inquirer/prompts");
      const mockInput = vi.mocked(input);

      // Setup
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Setup mocks
      const { DocumentRepository } = await import("../../../core/storage/repository.js");
      const mockHybridSearch = (
        DocumentRepository as unknown as { getMock: () => ReturnType<typeof vi.fn> }
      ).getMock();
      mockHybridSearch.mockResolvedValue([
        {
          id: "chunk1",
          content: "function add(a, b) { return a + b; }",
          filepath: "src/utils/math.ts",
          startLine: 10,
          endLine: 12,
          language: "typescript",
          type: "function",
          symbolName: "add",
        },
      ]);

      const llmModule = await import("../../../core/models/llm.js");
      const mockStream = (
        llmModule as unknown as { getMockStream: () => ReturnType<typeof vi.fn> }
      ).getMockStream();
      mockStream.mockImplementation(async function* () {
        await Promise.resolve();
        yield { content: "Test response" };
      });

      // Simulate user asking question then exiting
      mockInput.mockResolvedValueOnce("What is the add function?").mockResolvedValueOnce("/exit");

      await askCommand.parseAsync(["node", "test", "--cloud-ok"]);

      expect(mockHybridSearch).toHaveBeenCalledWith("What is the add function?", 10);
      expect(mockStream).toHaveBeenCalled();
    });

    it("should handle unknown command gracefully", async () => {
      const { input } = await import("@inquirer/prompts");
      const mockInput = vi.mocked(input);

      // Setup
      await writeProjectState(tempDir, {
        schemaVersion: 1,
        projectId: randomUUID(),
        initializedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectRoot: tempDir,
      });

      const lancedbPath = join(tempDir, PROJECT_DIR, "lancedb");
      await mkdir(lancedbPath, { recursive: true });

      process.env.OPENROUTER_API_KEY = "sk-test";

      // Simulate user typing unknown command then /exit
      mockInput.mockResolvedValueOnce("/unknown").mockResolvedValueOnce("/exit");

      await askCommand.parseAsync(["node", "test", "--cloud-ok"]);

      // Should continue after unknown command
      expect(mockInput).toHaveBeenCalledTimes(2);
    });
  });
});

describe("ask-templates", () => {
  describe("formatCodeContext", () => {
    it("should format chunks with citations", async () => {
      const { formatCodeContext } = await import("../../../agents/prompts/ask-templates.js");

      const chunks = [
        {
          id: "1",
          content: "function add(a, b) { return a + b; }",
          filepath: "src/math.ts",
          startLine: 10,
          endLine: 12,
          language: "typescript",
          type: "function",
          symbolName: "add",
        },
      ];

      const result = formatCodeContext(chunks);
      expect(result).toContain("[src/math.ts:10-12]");
      expect(result).toContain("function add");
      expect(result).toContain("typescript");
      expect(result).toContain("function");
      expect(result).toContain(": add");
    });

    it("should handle chunks without symbolName", async () => {
      const { formatCodeContext } = await import("../../../agents/prompts/ask-templates.js");

      const chunks = [
        {
          id: "1",
          content: "const x = 1;",
          filepath: "src/constants.ts",
          startLine: 1,
          endLine: 1,
          language: "typescript",
          type: "statement",
        },
      ];

      const result = formatCodeContext(chunks);
      expect(result).toContain("[src/constants.ts:1-1]");
      expect(result).not.toContain(": undefined");
    });

    it("should return empty string for empty chunks", async () => {
      const { formatCodeContext } = await import("../../../agents/prompts/ask-templates.js");
      expect(formatCodeContext([])).toBe("");
    });
  });

  describe("buildAskPrompt", () => {
    it("should build prompt with question only", async () => {
      const { buildAskPrompt } = await import("../../../agents/prompts/ask-templates.js");

      const result = buildAskPrompt("What is this?");
      expect(result).toContain("## Current Question");
      expect(result).toContain("What is this?");
      expect(result).not.toContain("## Previous Conversation Context");
    });

    it("should build prompt with history context", async () => {
      const { buildAskPrompt } = await import("../../../agents/prompts/ask-templates.js");

      const result = buildAskPrompt("Follow-up question?", "Q1: First\nA1: Answer");
      expect(result).toContain("## Previous Conversation Context");
      expect(result).toContain("Q1: First");
      expect(result).toContain("## Current Question");
      expect(result).toContain("Follow-up question?");
    });
  });

  describe("summarizeHistory", () => {
    it("should limit to maxEntries", async () => {
      const { summarizeHistory } = await import("../../../agents/prompts/ask-templates.js");

      const history = [
        { question: "First question", answer: "First answer" },
        { question: "Second question", answer: "Second answer" },
        { question: "Third question", answer: "Third answer" },
        { question: "Fourth question", answer: "Fourth answer" },
      ];

      const result = summarizeHistory(history, 2);
      // Should only include the last 2 entries
      expect(result).toContain("Third question");
      expect(result).toContain("Fourth question");
      expect(result).not.toContain("First question");
      expect(result).not.toContain("Second question");
    });

    it("should return empty string for empty history", async () => {
      const { summarizeHistory } = await import("../../../agents/prompts/ask-templates.js");
      expect(summarizeHistory([])).toBe("");
    });

    it("should truncate long answers", async () => {
      const { summarizeHistory } = await import("../../../agents/prompts/ask-templates.js");

      const longAnswer = "A".repeat(600);
      const history = [{ question: "Q1", answer: longAnswer }];

      const result = summarizeHistory(history);
      expect(result).toContain("[...]");
      expect(result.length).toBeLessThan(longAnswer.length + 50);
    });
  });
});
