/**
 * Prompt templates for the ask command (codebase Q&A).
 */

import type { CodeChunk } from "../../core/types/index.js";

/**
 * System prompt for the codebase Q&A assistant.
 */
export const ASK_SYSTEM_TEMPLATE = `You are an expert software engineer assistant helping users understand their codebase.

Your role is to answer questions about the codebase accurately and concisely, using the provided code context.

Guidelines:
- Base your answers ONLY on the provided code context
- When referencing code, always cite the source using the format [filepath:startLine-endLine]
- If the provided context doesn't contain enough information to answer, say so clearly
- Provide specific, actionable insights when possible
- Use code examples from the provided context when helpful
- Be concise but thorough

Citation format examples:
- "The function is defined in [src/utils/parser.ts:42-58]"
- "This pattern is used in [src/core/handler.ts:15-20] and [src/core/manager.ts:88-95]"
`;

/**
 * Response when no relevant code context is found.
 */
export const NO_CONTEXT_RESPONSE = `I couldn't find relevant code context to answer your question. This could mean:
- The question might be about code that wasn't indexed
- The search terms might need to be more specific
- The codebase might not contain relevant information

Try rephrasing your question or run \`ship-spec ask --reindex\` to ensure the index is up to date.`;

/**
 * Conversation history entry for Q&A tracking.
 */
export interface ConversationEntry {
  question: string;
  answer: string;
}

/**
 * Formats code chunks into a context block for the LLM.
 *
 * @param chunks - Array of code chunks from hybrid search
 * @returns Formatted context string with file paths and line numbers
 */
export function formatCodeContext(chunks: CodeChunk[]): string {
  if (chunks.length === 0) {
    return "";
  }

  const formattedChunks = chunks.map((chunk) => {
    const citation = `[${chunk.filepath}:${String(chunk.startLine)}-${String(chunk.endLine)}]`;
    const symbolInfo = chunk.symbolName ? `: ${chunk.symbolName}` : "";
    const header = `--- ${citation} (${chunk.language}, ${chunk.type}${symbolInfo}) ---`;
    return `${header}\n${chunk.content}`;
  });

  return `## Relevant Code Context\n\n${formattedChunks.join("\n\n")}`;
}

/**
 * Builds the user prompt with question and optional conversation history summary.
 *
 * @param question - The user's current question
 * @param historyContext - Optional summary of previous Q&A for context
 * @returns Formatted user prompt
 */
export function buildAskPrompt(question: string, historyContext?: string): string {
  let prompt = "";

  if (historyContext) {
    prompt += `## Previous Conversation Context\n${historyContext}\n\n`;
  }

  prompt += `## Current Question\n${question}`;

  return prompt;
}

/**
 * Truncates an answer to a maximum length, preserving complete sentences.
 *
 * @param answer - The answer text to truncate
 * @param maxLength - Maximum length in characters
 * @returns Truncated answer with ellipsis if needed
 */
function truncateAnswer(answer: string, maxLength: number): string {
  if (answer.length <= maxLength) {
    return answer;
  }

  const truncated = answer.slice(0, maxLength);
  const lastPeriod = truncated.lastIndexOf(". ");

  if (lastPeriod > maxLength * 0.6) {
    return truncated.slice(0, lastPeriod + 1) + " [...]";
  }

  return truncated + " [...]";
}

/**
 * Summarizes conversation history for token-efficient context.
 *
 * @param history - Array of question/answer pairs
 * @param maxEntries - Maximum number of recent entries to include (default: 3)
 * @returns Summarized history string
 */
export function summarizeHistory(history: ConversationEntry[], maxEntries = 3): string {
  if (history.length === 0) {
    return "";
  }

  const recentHistory = history.slice(-maxEntries);

  return recentHistory
    .map(
      (entry, i) =>
        `Q${String(i + 1)}: ${entry.question}\nA${String(i + 1)}: ${truncateAnswer(entry.answer, 500)}`
    )
    .join("\n\n");
}
