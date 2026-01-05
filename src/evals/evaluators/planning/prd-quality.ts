/**
 * Evaluators for planning PRD quality.
 */
import type { EvaluatorParams, EvaluationResult } from "../../types.js";

/**
 * Standard sections expected in a PRD.
 */
const STANDARD_PRD_SECTIONS = [
  "problem statement",
  "goals",
  "requirements",
  "success metrics",
  "user stories",
  "scope",
];

/**
 * Evaluates the quality and completeness of generated PRD.
 * Checks for:
 * - Standard PRD sections
 * - Required content terms
 * - PRD length/substance
 */
export function prdQualityEvaluator({
  outputs,
  referenceOutputs,
}: EvaluatorParams): EvaluationResult[] {
  const prd = typeof outputs.prd === "string" ? outputs.prd : "";
  const results: EvaluationResult[] = [];

  // 1. Standard Sections Check
  const sectionsFound = STANDARD_PRD_SECTIONS.filter((section) =>
    prd.toLowerCase().includes(section.toLowerCase())
  );
  const sectionScore = sectionsFound.length / STANDARD_PRD_SECTIONS.length;

  results.push({
    key: "prd_sections",
    score: sectionScore,
    comment: `Found ${String(sectionsFound.length)}/${String(STANDARD_PRD_SECTIONS.length)} standard PRD sections`,
  });

  // 2. Required Content Check
  const mustContain = Array.isArray(referenceOutputs?.prdMustContain)
    ? (referenceOutputs.prdMustContain as string[])
    : [];
  if (mustContain.length > 0) {
    const termsFound = mustContain.filter((term) => prd.toLowerCase().includes(term.toLowerCase()));
    const contentScore = termsFound.length / mustContain.length;

    results.push({
      key: "prd_required_content",
      score: contentScore,
      comment: `Found ${String(termsFound.length)}/${String(mustContain.length)} required terms in PRD`,
    });
  }

  // 3. PRD Length - sanity check for substance
  const wordCount = prd.split(/\s+/).filter(Boolean).length;
  const hasSubstantialContent = wordCount >= 200;

  results.push({
    key: "prd_length",
    score: hasSubstantialContent ? 1 : wordCount / 200,
    comment: `PRD contains ${String(wordCount)} words`,
  });

  // 4. Has Actionable Items - look for bullet points or numbered lists
  const hasBulletPoints = /[-*]\s+.+/m.test(prd);
  const hasNumberedList = /\d+\.\s+.+/m.test(prd);
  const hasActionableFormat = hasBulletPoints || hasNumberedList;

  results.push({
    key: "prd_actionable_format",
    score: hasActionableFormat ? 1 : 0,
    comment: hasActionableFormat
      ? "PRD contains actionable list items"
      : "PRD lacks bullet points or numbered lists",
  });

  return results;
}
