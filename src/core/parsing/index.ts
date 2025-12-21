import { CodeChunk } from "../types/index.js";
import { SemanticChunker, type ChunkOptions } from "./chunker.js";
import { isFallbackRequired, splitWithFallback } from "./fallback-splitter.js";
import { logger } from "../../utils/logger.js";

export type { ChunkOptions } from "./chunker.js";
export { SemanticChunker } from "./chunker.js";
export {
  getLanguageFromExtension,
  LANGUAGE_REGISTRY,
  type SupportedLanguage,
} from "./language-registry.js";
export { createParser, initTreeSitter, loadLanguage } from "./tree-sitter.js";
export { isFallbackRequired, splitWithFallback } from "./fallback-splitter.js";

export async function chunkSourceFile(
  filepath: string,
  content: string,
  options?: ChunkOptions
): Promise<CodeChunk[]> {
  if (isFallbackRequired(filepath)) {
    return splitWithFallback(filepath, content);
  }

  const chunker = new SemanticChunker(options);
  try {
    return await chunker.chunkFile(filepath, content);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Tree-sitter parse failed for ${filepath}, using fallback${errorMsg ? `: ${errorMsg}` : ""}`
    );
    if (error instanceof Error && error.stack) {
      logger.debug(error.stack, true);
    }
    return splitWithFallback(filepath, content);
  }
}
