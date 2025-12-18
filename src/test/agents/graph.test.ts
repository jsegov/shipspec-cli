import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSpecGraph } from "../../agents/graph.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { Embeddings } from "@langchain/core/embeddings";

vi.mock("langchain/chat_models/universal", () => ({
  initChatModel: vi.fn(),
}));

vi.mock("../../agents/nodes/planner.js", () => ({
  createPlannerNode: vi.fn((model) => vi.fn()),
}));

vi.mock("../../agents/nodes/worker.js", () => ({
  createWorkerNode: vi.fn((model, tool, tokenBudget) => vi.fn()),
}));

vi.mock("../../agents/nodes/aggregator.js", () => ({
  createAggregatorNode: vi.fn((model, tokenBudget) => vi.fn()),
}));

vi.mock("../../agents/tools/retriever.js", () => ({
  createRetrieverTool: vi.fn(() => ({})),
}));

describe("createSpecGraph", () => {
  let mockConfig: ShipSpecConfig;
  let mockRepository: DocumentRepository;
  let mockModel: Partial<BaseChatModel>;

  beforeEach(async () => {
    mockModel = {
      invoke: vi.fn(),
      bindTools: vi.fn().mockReturnThis(),
      withStructuredOutput: vi.fn().mockReturnThis(),
    };

    const { initChatModel } = await import("langchain/chat_models/universal");
    (initChatModel as ReturnType<typeof vi.fn>).mockResolvedValue(mockModel);

    mockConfig = {
      projectPath: ".",
      vectorDbPath: ".ship-spec/lancedb",
      ignorePatterns: [],
      llm: {
        provider: "openai",
        modelName: "gpt-4-turbo",
        temperature: 0,
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      },
      embedding: {
        provider: "openai",
        modelName: "text-embedding-3-small",
        dimensions: 1536,
        maxRetries: 3,
      },
      checkpoint: {
        enabled: false,
        type: "memory",
      },
    };

    mockRepository = new DocumentRepository(
      {} as unknown as LanceDBManager,
      {} as unknown as Embeddings,
      1536
    );
  });

  it("should create a compiled graph", async () => {
    const graph = await createSpecGraph(mockConfig, mockRepository);

    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });

  it("should initialize chat model with correct config", async () => {
    const { initChatModel } = await import("langchain/chat_models/universal");
    
    await createSpecGraph(mockConfig, mockRepository);

    expect(initChatModel).toHaveBeenCalledWith("gpt-4-turbo", {
      modelProvider: "openai",
      temperature: 0,
      maxRetries: 3,
    });
  });

  it("should create retriever tool with repository", async () => {
    const { createRetrieverTool } = await import("../../agents/tools/retriever.js");
    
    await createSpecGraph(mockConfig, mockRepository);

    expect(createRetrieverTool).toHaveBeenCalledWith(mockRepository);
  });

  it("should create all nodes", async () => {
    const { createPlannerNode } = await import("../../agents/nodes/planner.js");
    const { createWorkerNode } = await import("../../agents/nodes/worker.js");
    const { createAggregatorNode } = await import("../../agents/nodes/aggregator.js");
    
    await createSpecGraph(mockConfig, mockRepository);

    expect(createPlannerNode).toHaveBeenCalledWith(mockModel);
    expect(createWorkerNode).toHaveBeenCalled();
    expect(createAggregatorNode).toHaveBeenCalledWith(mockModel, {
      maxContextTokens: 16000,
      reservedOutputTokens: 4000,
    });
  });

  it("should handle different LLM providers", async () => {
    const { initChatModel } = await import("langchain/chat_models/universal");
    
    const anthropicConfig: ShipSpecConfig = {
      ...mockConfig,
      llm: {
        provider: "anthropic",
        modelName: "claude-3-opus",
        temperature: 0.7,
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      },
    };

    await createSpecGraph(anthropicConfig, mockRepository);

    expect(initChatModel).toHaveBeenCalledWith("claude-3-opus", {
      modelProvider: "anthropic",
      temperature: 0.7,
      maxRetries: 3,
    });
  });

  it("should pass baseUrl and apiKey when provided", async () => {
    const { initChatModel } = await import("langchain/chat_models/universal");
    
    const configWithUrl: ShipSpecConfig = {
      ...mockConfig,
      llm: {
        provider: "ollama",
        modelName: "llama2",
        temperature: 0,
        baseUrl: "http://localhost:11434",
        apiKey: "test-key",
        maxRetries: 3,
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      },
    };

    await createSpecGraph(configWithUrl, mockRepository);

    expect(initChatModel).toHaveBeenCalledWith("llama2", {
      modelProvider: "ollama",
      temperature: 0,
      maxRetries: 3,
      baseUrl: "http://localhost:11434",
      apiKey: "test-key",
    });
  });

  it("should pass token budget to worker and aggregator nodes", async () => {
    const { createWorkerNode } = await import("../../agents/nodes/worker.js");
    const { createAggregatorNode } = await import("../../agents/nodes/aggregator.js");
    
    await createSpecGraph(mockConfig, mockRepository);

    expect(createWorkerNode).toHaveBeenCalledWith(
      mockModel,
      expect.anything(),
      {
        maxContextTokens: 16000,
        reservedOutputTokens: 4000,
      }
    );
    expect(createAggregatorNode).toHaveBeenCalledWith(mockModel, {
      maxContextTokens: 16000,
      reservedOutputTokens: 4000,
    });
  });

  it("should accept optional checkpointer", async () => {
    const mockCheckpointer = { type: "memory" };
    
    const graph = await createSpecGraph(mockConfig, mockRepository, {
      checkpointer: mockCheckpointer as any,
    });

    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });

  it("should create graph without checkpointer when not provided", async () => {
    const graph = await createSpecGraph(mockConfig, mockRepository);

    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });
});
