/**
 * Evaluators for productionalize report quality.
 */
import type { EvaluatorParams, EvaluationResult } from "../../types.js";

/**
 * Evaluates the quality and structure of the generated report.
 * Checks for:
 * - Executive summary presence
 * - Category coverage
 * - Required content terms
 */
export function reportQualityEvaluator({
  outputs,
  referenceOutputs,
}: EvaluatorParams): EvaluationResult[] {
  const report = typeof outputs.finalReport === "string" ? outputs.finalReport : "";
  const results: EvaluationResult[] = [];

  // 1. Report Structure Score - check for executive summary
  const hasExecutiveSummary =
    report.includes("## Executive Summary") ||
    report.includes("# Executive Summary") ||
    report.includes("## Summary") ||
    report.includes("# Summary");

  results.push({
    key: "report_structure",
    score: hasExecutiveSummary ? 1 : 0,
    comment: hasExecutiveSummary
      ? "Report has executive summary"
      : "Report missing executive summary section",
  });

  // 2. Category Coverage - check expected categories appear in report
  const expectedCategories = Array.isArray(referenceOutputs?.expectedCategories)
    ? (referenceOutputs.expectedCategories as string[])
    : [];
  if (expectedCategories.length > 0) {
    const categoriesFound = expectedCategories.filter((cat) =>
      report.toLowerCase().includes(cat.toLowerCase())
    );
    const coverageScore = categoriesFound.length / expectedCategories.length;

    results.push({
      key: "category_coverage",
      score: coverageScore,
      comment: `Covered ${String(categoriesFound.length)}/${String(expectedCategories.length)} expected categories`,
    });
  }

  // 3. Required Content Check - verify must-contain terms
  const mustContain = Array.isArray(referenceOutputs?.reportMustContain)
    ? (referenceOutputs.reportMustContain as string[])
    : [];
  if (mustContain.length > 0) {
    const termsFound = mustContain.filter((term) =>
      report.toLowerCase().includes(term.toLowerCase())
    );
    const contentScore = termsFound.length / mustContain.length;

    results.push({
      key: "required_content",
      score: contentScore,
      comment: `Found ${String(termsFound.length)}/${String(mustContain.length)} required terms`,
    });
  }

  // 4. Report Length - basic sanity check
  const wordCount = report.split(/\s+/).length;
  const hasSubstantialContent = wordCount >= 100;

  results.push({
    key: "report_length",
    score: hasSubstantialContent ? 1 : wordCount / 100,
    comment: `Report contains ${String(wordCount)} words`,
  });

  return results;
}
