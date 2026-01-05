/**
 * Evaluators for ask workflow citation accuracy.
 */
import type { EvaluatorParams, EvaluationResult } from "../../types.js";

/**
 * Extracts file citations from answer text.
 * Looks for patterns like:
 * - [filepath:line-line]
 * - `filepath`
 * - filepath:123
 */
function extractCitations(text: string): string[] {
  const citations = new Set<string>();

  // Pattern 1: [filepath:line-line] or [filepath:line]
  const bracketPattern = /\[([^\]]+?)(?::\d+(?:-\d+)?)?\]/g;
  for (const match of text.matchAll(bracketPattern)) {
    if (match[1]?.includes("/")) {
      citations.add(match[1]);
    }
  }

  // Pattern 2: `filepath` in backticks
  const backtickPattern = /`([^`]+?\.(?:ts|js|py|go|rs|tsx|jsx|json|yaml|yml|md))`/g;
  for (const match of text.matchAll(backtickPattern)) {
    if (match[1]) {
      citations.add(match[1]);
    }
  }

  // Pattern 3: filepath:line references
  const lineRefPattern = /(?:^|\s)([\w/.-]+\.(?:ts|js|py|go|rs|tsx|jsx))(?::\d+)?/gm;
  for (const match of text.matchAll(lineRefPattern)) {
    if (match[1]) {
      citations.add(match[1]);
    }
  }

  return Array.from(citations);
}

/**
 * Evaluates the accuracy of code citations in answers.
 * Checks for:
 * - Required file citations present
 * - Has any citations
 * - Citation format validity
 */
export function citationAccuracyEvaluator({
  outputs,
  referenceOutputs,
}: EvaluatorParams): EvaluationResult[] {
  const answer = typeof outputs.answer === "string" ? outputs.answer : "";
  const results: EvaluationResult[] = [];

  const citations = extractCitations(answer);

  // 1. Required Citations Check
  const mustCiteFiles = Array.isArray(referenceOutputs?.mustCiteFiles)
    ? (referenceOutputs.mustCiteFiles as string[])
    : [];
  if (mustCiteFiles.length > 0) {
    const citedRequired = mustCiteFiles.filter((file) =>
      citations.some((c) => c.includes(file) || file.includes(c))
    );

    results.push({
      key: "required_citations",
      score: citedRequired.length / mustCiteFiles.length,
      comment: `Cited ${String(citedRequired.length)}/${String(mustCiteFiles.length)} required files`,
    });
  }

  // 2. Has Citations Check
  const hasCitations = citations.length > 0;

  results.push({
    key: "has_citations",
    score: hasCitations ? 1 : 0,
    comment: hasCitations
      ? `Found ${String(citations.length)} code citations`
      : "No code citations found in answer",
  });

  // 3. Citation Diversity - not all from same file
  if (citations.length > 1) {
    const uniqueDirs = new Set(citations.map((c) => c.split("/").slice(0, -1).join("/")));
    const diversityScore = Math.min(uniqueDirs.size / 2, 1);

    results.push({
      key: "citation_diversity",
      score: diversityScore,
      comment: `Citations span ${String(uniqueDirs.size)} different directories`,
    });
  }

  // 4. Code Blocks Check - answer includes code examples
  const hasCodeBlocks = /```[\s\S]*?```/.test(answer);
  const hasInlineCode = /`[^`]+`/.test(answer);
  const hasCodeExamples = hasCodeBlocks || hasInlineCode;

  results.push({
    key: "has_code_examples",
    score: hasCodeExamples ? 1 : 0,
    comment: hasCodeExamples ? "Answer includes code examples" : "Answer lacks code examples",
  });

  return results;
}
