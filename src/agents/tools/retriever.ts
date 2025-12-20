import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { DocumentRepository } from "../../core/storage/repository.js";

export function createRetrieverTool(repository: DocumentRepository) {
  return new DynamicStructuredTool({
    name: "retrieve_code",
    description: "Search the codebase for code chunks relevant to a query",
    schema: z.object({
      query: z.string().describe("The search query"),
      k: z.number().optional().default(10).describe("Number of results"),
    }),
    func: async ({ query, k }) => {
      const chunks = await repository.hybridSearch(query, k);
      return JSON.stringify(chunks.map((c) => ({
        filepath: c.filepath,
        content: c.content,
        type: c.type,
        symbolName: c.symbolName ?? null,
        lines: `${String(c.startLine)}-${String(c.endLine)}`,
      })));
    },
  });
}
