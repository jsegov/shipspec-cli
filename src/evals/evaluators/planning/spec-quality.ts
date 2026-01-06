/**
 * Evaluators for planning tech spec quality.
 */
import type { EvaluatorParams, EvaluationResult } from "../../types.js";

/**
 * Standard sections expected in a tech spec (updated for Atlassian best practices with RTM).
 */
const STANDARD_SPEC_SECTIONS = [
  "overview",
  "requirements traceability",
  "architecture",
  "data models",
  "api design",
  "implementation plan",
  "testing strategy",
  "risks",
  "security",
  "performance",
];

/**
 * Evaluates the quality and completeness of generated tech spec.
 * Checks for:
 * - Standard spec sections
 * - Requirements Traceability Matrix
 * - Inline requirement references ([Fulfills: ...])
 * - Requirement coverage
 */
export function specQualityEvaluator({
  outputs,
}: EvaluatorParams): EvaluationResult[] {
  const spec = typeof outputs.techSpec === "string" ? outputs.techSpec : "";
  const results: EvaluationResult[] = [];

  // 1. Standard Sections Check
  const sectionsFound = STANDARD_SPEC_SECTIONS.filter((section) =>
    spec.toLowerCase().includes(section.toLowerCase())
  );
  const sectionScore = sectionsFound.length / STANDARD_SPEC_SECTIONS.length;

  results.push({
    key: "spec_sections",
    score: sectionScore,
    comment: `Found ${String(sectionsFound.length)}/${String(STANDARD_SPEC_SECTIONS.length)} standard spec sections`,
  });

  // 2. Requirements Traceability Matrix Check
  const hasRTM = /requirements\s+traceability\s+matrix/i.test(spec);
  const hasTable = /\|.*\|.*\|/m.test(spec);
  const rtmScore = hasRTM && hasTable ? 1 : hasRTM || hasTable ? 0.5 : 0;

  results.push({
    key: "spec_rtm",
    score: rtmScore,
    comment: hasRTM
      ? "Has Requirements Traceability Matrix"
      : "Missing Requirements Traceability Matrix",
  });

  // 3. Inline References Check ([Fulfills: FR-XXX, NFR-XXX])
  const fulfillsPattern = /\[Fulfills:?\s*(?:FR|NFR)-\d{3}/gi;
  const fulfillsMatches = spec.match(fulfillsPattern) ?? [];
  const inlineRefScore = fulfillsMatches.length >= 3 ? 1 : fulfillsMatches.length / 3;

  results.push({
    key: "spec_inline_refs",
    score: inlineRefScore,
    comment: `Found ${String(fulfillsMatches.length)} inline requirement references`,
  });

  // 4. Requirement IDs Present (both FR-XXX and NFR-XXX)
  const reqPattern = /(?:(?<![N])FR|NFR)-\d{3}/g;
  const reqMatches = spec.match(reqPattern) ?? [];
  const uniqueReqs = new Set(reqMatches);
  const reqCoverageScore = uniqueReqs.size >= 5 ? 1 : uniqueReqs.size / 5;

  results.push({
    key: "spec_requirement_coverage",
    score: reqCoverageScore,
    comment: `References ${String(uniqueReqs.size)} unique requirements`,
  });

  // 5. Spec Length - sanity check for substance
  const wordCount = spec.split(/\s+/).filter(Boolean).length;
  const hasSubstantialContent = wordCount >= 500;

  results.push({
    key: "spec_length",
    score: hasSubstantialContent ? 1 : wordCount / 500,
    comment: `Tech spec contains ${String(wordCount)} words`,
  });

  // 6. Test Coverage Matrix Check
  const hasTestCoverageMatrix = /test\s+coverage\s+matrix/i.test(spec);
  const hasTestTable = /\|\s*(?:FR|NFR)-\d{3}\s*\|.*(?:Yes|No)/im.test(spec);

  results.push({
    key: "spec_test_matrix",
    score: hasTestCoverageMatrix || hasTestTable ? 1 : 0,
    comment: hasTestCoverageMatrix || hasTestTable
      ? "Has test coverage matrix"
      : "Missing test coverage matrix",
  });

  return results;
}
