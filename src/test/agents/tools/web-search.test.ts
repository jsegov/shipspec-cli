import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWebSearchTool } from "../../../agents/tools/web-search.js";

// Mock Tavily
vi.mock("@langchain/tavily", () => {
  const TavilySearch = vi.fn(function () {
    return {
      invoke: vi.fn().mockResolvedValue("tavily results"),
    };
  });
  return { TavilySearch };
});

// Mock DuckDuckGo
vi.mock("duck-duck-scrape", () => {
  return {
    search: vi.fn().mockResolvedValue({
      results: [{ title: "ddg title", url: "ddg.com", description: "ddg desc" }],
    }),
    SafeSearchType: {
      STRICT: "STRICT",
    },
  };
});

describe("Web Search Tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should use Tavily if API key is provided", async () => {
    const tool = createWebSearchTool({ provider: "tavily", apiKey: "test-key" });
    const result = await tool.invoke({ query: "test query" });
    expect(result).toBe("tavily results");
  });

  it("should fallback to DuckDuckGo if Tavily API key is missing", async () => {
    const tool = createWebSearchTool({ provider: "tavily" });
    const result = await tool.invoke({ query: "test query" });
    const parsed = JSON.parse(result);
    expect(parsed[0].title).toBe("ddg title");
  });

  it("should use DuckDuckGo if explicitly configured", async () => {
    const tool = createWebSearchTool({ provider: "duckduckgo" });
    const result = await tool.invoke({ query: "test query" });
    const parsed = JSON.parse(result);
    expect(parsed[0].title).toBe("ddg title");
  });
});
