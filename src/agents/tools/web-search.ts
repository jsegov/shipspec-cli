import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { TavilySearch } from "@langchain/tavily";
import { search, SafeSearchType } from "duck-duck-scrape";
import type { WebSearchConfig } from "../../config/schema.js";

export function createWebSearchTool(config?: WebSearchConfig) {
  return new DynamicStructuredTool({
    name: "web_search",
    description:
      "Search the web for security standards, compliance requirements, or best practices",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().optional().default(5).describe("Maximum number of results to return"),
    }),
    func: async ({ query, maxResults }) => {
      const apiKey = config?.apiKey ?? process.env.TAVILY_API_KEY;
      const limit = maxResults;

      if (apiKey && config?.provider !== "duckduckgo") {
        try {
          const tavily = new TavilySearch({
            tavilyApiKey: apiKey,
            maxResults: limit,
          });
          const results: unknown = await tavily.invoke({ query });
          return typeof results === "string" ? results : JSON.stringify(results);
        } catch (error) {
          console.error("Tavily search failed, falling back to DuckDuckGo:", error);
        }
      }

      // Fallback to DuckDuckGo
      try {
        const results = await search(query, { safeSearch: SafeSearchType.STRICT });
        return JSON.stringify(
          results.results.slice(0, limit).map((r) => ({
            title: r.title,
            url: r.url,
            content: r.description,
          }))
        );
      } catch (error) {
        return `Web search failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}
