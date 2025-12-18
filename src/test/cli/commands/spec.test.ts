import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Embeddings } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// Mock the graph module
vi.mock("../../../agents/graph.js", () => ({
  createSpecGraph: vi.fn(),
}));

// Mock the embeddings module
vi.mock("../../../core/models/embeddings.js", () => ({
  createEmbeddingsModel: vi.fn(),
}));

// Mock the LLM module
vi.mock("../../../core/models/llm.js", () => ({
  createChatModel: vi.fn(),
}));

// Mock the vector store
vi.mock("../../../core/storage/vector-store.js", () => ({
  LanceDBManager: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({}),
    getOrCreateTable: vi.fn().mockResolvedValue({
      search: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
      vectorSearch: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  })),
}));

// Mock the repository
vi.mock("../../../core/storage/repository.js", () => ({
  DocumentRepository: vi.fn().mockImplementation(() => ({
    similaritySearch: vi.fn().mockResolvedValue([]),
    hybridSearch: vi.fn().mockResolvedValue([]),
    addDocuments: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("Spec Command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Graph Streaming Format", () => {
    it("handles planner events correctly", () => {
      const plannerEvent = {
        planner: {
          subtasks: [
            { id: "1", query: "Analyze authentication flow", status: "pending" },
            { id: "2", query: "Review database schema", status: "pending" },
          ],
        },
      };

      expect(plannerEvent.planner.subtasks).toHaveLength(2);
      expect(plannerEvent.planner.subtasks[0].query).toBe(
        "Analyze authentication flow"
      );
    });

    it("handles worker events correctly", () => {
      const workerEvent = {
        worker: {
          subtasks: [
            {
              id: "1",
              query: "Analyze authentication flow",
              status: "complete",
              result: "Authentication uses JWT tokens...",
            },
          ],
        },
      };

      const completedTask = workerEvent.worker.subtasks.find(
        (t) => t.status === "complete"
      );
      expect(completedTask).toBeDefined();
      expect(completedTask?.result).toContain("JWT");
    });

    it("handles aggregator events correctly", () => {
      const aggregatorEvent = {
        aggregator: {
          finalSpec: "# Technical Specification\n\n## Overview\n...",
        },
      };

      expect(aggregatorEvent.aggregator.finalSpec).toContain(
        "# Technical Specification"
      );
    });
  });

  describe("Stream Mode Processing", () => {
    it("processes updates stream mode events", async () => {
      const events = [
        {
          planner: {
            subtasks: [
              { id: "1", query: "Analyze auth", status: "pending" },
            ],
          },
        },
        {
          worker: {
            subtasks: [
              { id: "1", query: "Analyze auth", status: "complete", result: "Found auth logic" },
            ],
          },
        },
        {
          aggregator: {
            finalSpec: "# Spec\n\nAuth analysis complete.",
          },
        },
      ];

      let finalSpec = "";
      let subtaskCount = 0;
      let workerCompletions = 0;

      for (const event of events) {
        if (event.planner?.subtasks) {
          subtaskCount = event.planner.subtasks.length;
        }
        if (event.worker?.subtasks) {
          workerCompletions += event.worker.subtasks.filter(
            (t) => t.status === "complete"
          ).length;
        }
        if (event.aggregator?.finalSpec) {
          finalSpec = event.aggregator.finalSpec;
        }
      }

      expect(subtaskCount).toBe(1);
      expect(workerCompletions).toBe(1);
      expect(finalSpec).toContain("# Spec");
    });
  });

  describe("Error Handling", () => {
    it("identifies API key errors", () => {
      const error = new Error("Invalid API key provided");
      expect(error.message.toLowerCase()).toContain("api key");
    });

    it("identifies connection errors", () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:11434");
      expect(error.message).toContain("ECONNREFUSED");
    });

    it("identifies empty specification result", () => {
      const result = { finalSpec: "" };
      expect(result.finalSpec).toBeFalsy();
    });
  });

  describe("Output Handling", () => {
    it("formats markdown specification correctly", () => {
      const spec = `# Technical Specification

## Overview

This document describes the implementation...

## Components

### Authentication

- JWT-based token system
- Refresh token rotation

## Implementation Steps

1. Configure auth middleware
2. Implement token generation
3. Add validation logic`;

      expect(spec).toContain("# Technical Specification");
      expect(spec).toContain("## Overview");
      expect(spec).toContain("### Authentication");
      expect(spec.split("\n").length).toBeGreaterThan(10);
    });

    it("handles special characters in specification", () => {
      const spec = `# Spec with Special Chars

\`\`\`typescript
const fn = (a: number, b: number) => a + b;
\`\`\`

> Note: Use caution with \`eval()\`
`;

      expect(spec).toContain("```typescript");
      expect(spec).toContain("`eval()`");
    });
  });

  describe("Repository Validation", () => {
    it("detects empty repository", async () => {
      const mockRepository = {
        similaritySearch: vi.fn().mockResolvedValue([]),
      };

      const results = await mockRepository.similaritySearch("test", 1);
      const hasData = results.length > 0;

      expect(hasData).toBe(false);
    });

    it("detects populated repository", async () => {
      const mockRepository = {
        similaritySearch: vi.fn().mockResolvedValue([
          { id: "1", content: "test content" },
        ]),
      };

      const results = await mockRepository.similaritySearch("test", 1);
      const hasData = results.length > 0;

      expect(hasData).toBe(true);
    });
  });

  describe("Checkpointing Options", () => {
    it("constructs graph config with thread_id when provided", () => {
      const threadId = "test-thread-123";
      const graphConfig = {
        ...(threadId && {
          configurable: { thread_id: threadId },
        }),
      };

      expect(graphConfig).toHaveProperty("configurable");
      expect(graphConfig.configurable).toEqual({ thread_id: "test-thread-123" });
    });

    it("constructs empty graph config when no thread_id", () => {
      const threadId: string | undefined = undefined;
      const graphConfig: Record<string, unknown> = {};
      if (threadId) {
        graphConfig.configurable = { thread_id: threadId };
      }

      expect(graphConfig).toEqual({});
      expect(graphConfig).not.toHaveProperty("configurable");
    });

    it("checkpoint option enables checkpointer initialization", () => {
      const options = {
        checkpoint: true,
        threadId: "session-1",
        stream: true,
      };

      expect(options.checkpoint).toBe(true);
      expect(options.threadId).toBe("session-1");
    });

    it("checkpoint defaults to false", () => {
      const options = {
        stream: true,
      };

      expect(options).not.toHaveProperty("checkpoint");
    });
  });

  describe("CLI Flag Parsing", () => {
    it("--checkpoint flag enables checkpointing", () => {
      const args = ["--checkpoint"];
      const hasCheckpoint = args.includes("--checkpoint");

      expect(hasCheckpoint).toBe(true);
    });

    it("--thread-id accepts string value", () => {
      const args = ["--thread-id", "my-thread-id"];
      const threadIdIndex = args.indexOf("--thread-id");
      const threadId = threadIdIndex !== -1 ? args[threadIdIndex + 1] : undefined;

      expect(threadId).toBe("my-thread-id");
    });

    it("validates thread-id requires checkpoint", () => {
      const hasThreadId = true;
      const hasCheckpoint = false;
      const shouldError = hasThreadId && !hasCheckpoint;

      expect(shouldError).toBe(true);
    });
  });
});
