import type { CodeChunk } from "../core/types/index.js";

export interface TokenBudget {
  maxContextTokens: number;
  reservedOutputTokens: number;
}

export function countTokensApprox(text: string): number {
  return Math.ceil(text.length / 4);
}

export function countChunkTokens(chunks: CodeChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + countTokensApprox(chunk.content), 0);
}

export function pruneChunksByTokenBudget(
  chunks: CodeChunk[],
  budget: number
): CodeChunk[] {
  let total = 0;
  const result: CodeChunk[] = [];

  for (const chunk of chunks) {
    const tokens = countTokensApprox(chunk.content);
    if (total + tokens > budget) {
      break;
    }
    result.push(chunk);
    total += tokens;
  }

  return result;
}

export function truncateTextByTokenBudget(
  text: string,
  budget: number
): string {
  const estimatedTokens = countTokensApprox(text);

  if (estimatedTokens <= budget) {
    return text;
  }

  const charLimit = budget * 4;
  const truncated = text.slice(0, charLimit);

  const lastNewline = truncated.lastIndexOf("\n");
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastSpace = truncated.lastIndexOf(" ");

  const breakPoint = Math.max(
    lastNewline > charLimit * 0.8 ? lastNewline : -1,
    lastPeriod > charLimit * 0.8 ? lastPeriod + 1 : -1,
    lastSpace > charLimit * 0.9 ? lastSpace : -1
  );

  if (breakPoint > 0) {
    return truncated.slice(0, breakPoint) + "\n\n[... content truncated due to token budget ...]";
  }

  return truncated + "\n\n[... content truncated due to token budget ...]";
}

export function getAvailableContextBudget(budget: TokenBudget): number {
  return Math.max(0, budget.maxContextTokens - budget.reservedOutputTokens);
}
