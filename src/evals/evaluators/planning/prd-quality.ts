/**
 * Evaluators for planning PRD quality.
 */
import type { EvaluatorParams, EvaluationResult } from "../../types.js";

/**
 * Evaluator thresholds for PRD quality checks.
 */
const MIN_PRD_WORD_COUNT = 200;
const MIN_PRIORITY_LEVELS = 2;

/**
 * Standard sections expected in a PRD (updated for Atlassian best practices).
 */
const STANDARD_PRD_SECTIONS = [
  "problem statement",
  "status",
  "background",
  "strategic fit",
  "goals",
  "requirements",
  "success metrics",
  "user stories",
  "ux design",
  "non-goals",
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
  const hasSubstantialContent = wordCount >= MIN_PRD_WORD_COUNT;

  results.push({
    key: "prd_length",
    score: hasSubstantialContent ? 1 : wordCount / MIN_PRD_WORD_COUNT,
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

  // 5. Requirement IDs Check (FR-XXX, NFR-XXX pattern)
  // Use word boundary to avoid matching FR- or NFR- inside other strings
  const functionalPattern = /\bFR-\d{3}/g;
  const nonFunctionalPattern = /\bNFR-\d{3}/g;
  const frMatches = prd.match(functionalPattern) ?? [];
  const nfrMatches = prd.match(nonFunctionalPattern) ?? [];
  const hasRequirementIds = frMatches.length > 0 || nfrMatches.length > 0;

  results.push({
    key: "prd_requirement_ids",
    score: hasRequirementIds ? 1 : 0,
    comment: hasRequirementIds
      ? `Found ${String(frMatches.length)} FR ID${frMatches.length !== 1 ? "s" : ""} and ${String(nfrMatches.length)} NFR ID${nfrMatches.length !== 1 ? "s" : ""}`
      : "No requirement IDs found (expected FR-XXX, NFR-XXX format)",
  });

  // 6. Priority Classification Check (P0, P1, P2)
  // Use word boundaries to avoid matching within words like HTTP2 or HTTP1
  const priorityPattern = /\bP[0-2]\b/g;
  const priorityMatches = prd.match(priorityPattern) ?? [];
  const uniquePriorities = new Set(priorityMatches);
  const hasPriorityClassification = uniquePriorities.size >= MIN_PRIORITY_LEVELS;

  results.push({
    key: "prd_priority_classification",
    score: hasPriorityClassification ? 1 : uniquePriorities.size / MIN_PRIORITY_LEVELS,
    comment: `Found ${String(uniquePriorities.size)} priority levels (P0/P1/P2)`,
  });

  return results;
}
