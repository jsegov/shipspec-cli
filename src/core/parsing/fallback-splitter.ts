import { extname } from "path";
import { randomUUID } from "crypto";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { CodeChunk } from "../types/index.js";
import { getLanguageFromExtension } from "./language-registry.js";

const FALLBACK_EXTENSIONS = [
  ".yaml",
  ".yml",
  ".json",
  ".md",
  ".sql",
  ".toml",
  ".txt",
  ".csv",
];

export function isFallbackRequired(filepath: string): boolean {
  const ext = extname(filepath).toLowerCase();
  return (
    FALLBACK_EXTENSIONS.includes(ext) ||
    getLanguageFromExtension(filepath) === null
  );
}

export async function splitWithFallback(
  filepath: string,
  content: string,
  options: { chunkSize?: number; chunkOverlap?: number } = {}
): Promise<CodeChunk[]> {
  if (!content.trim()) {
    return [];
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? 1500,
    chunkOverlap: options.chunkOverlap ?? 200,
  });

  const docs = await splitter.createDocuments([content]);

  const lines = content.split("\n");
  let lastSearchIndex = 0;

  return docs.map((doc) => {
    const chunkContent = doc.pageContent;
    const startIndex = content.indexOf(chunkContent, lastSearchIndex);
    
    const effectiveIndex = startIndex === -1 ? content.indexOf(chunkContent) : startIndex;
    if (effectiveIndex !== -1) {
      lastSearchIndex = effectiveIndex;
    }

    const beforeContent = content.slice(0, effectiveIndex);
    const chunkStartLine = beforeContent.split("\n").length - 1;
    const chunkLines = chunkContent.split("\n").length;

    return {
      id: randomUUID(),
      content: chunkContent,
      filepath,
      startLine: chunkStartLine,
      endLine: Math.min(chunkStartLine + chunkLines - 1, lines.length - 1),
      language: extname(filepath).slice(1) || "text",
      type: "module",
    };
  });
}
