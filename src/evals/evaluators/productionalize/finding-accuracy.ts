/**
 * Evaluators for productionalize finding accuracy.
 */
import type { EvaluatorParams, EvaluationResult, Severity } from "../../types.js";
import { severityToNumber } from "../../types.js";

interface Finding {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
}

interface ExpectedFinding {
  category: string;
  severityMin: Severity;
  titlePattern?: string;
}

/**
 * Safely tests if a title matches a regex pattern.
 * Returns true if no pattern is provided, or if the pattern matches.
 * Returns false if the pattern is invalid or doesn't match.
 *
 * @param title - The title string to test
 * @param pattern - Optional regex pattern string
 * @returns Object with match result and optional error message
 */
function safeRegexTest(
  title: string,
  pattern: string | undefined
): { matches: boolean; error?: string } {
  if (!pattern) {
    return { matches: true };
  }

  try {
    const regex = new RegExp(pattern, "i");
    return { matches: regex.test(title) };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : "Unknown regex error";
    return { matches: false, error: `Invalid regex "${pattern}": ${errorMessage}` };
  }
}

/**
 * Evaluates the accuracy and completeness of findings.
 * Checks for:
 * - Minimum finding count
 * - Required findings presence
 * - Finding quality (has descriptions, evidence)
 */
export function findingAccuracyEvaluator({
  outputs,
  referenceOutputs,
}: EvaluatorParams): EvaluationResult[] {
  const findings = Array.isArray(outputs.findings) ? (outputs.findings as Finding[]) : [];
  const results: EvaluationResult[] = [];

  // 1. Minimum Finding Count
  const minCount =
    typeof referenceOutputs?.minFindingCount === "number" ? referenceOutputs.minFindingCount : 0;
  if (minCount > 0) {
    const countScore = findings.length >= minCount ? 1 : findings.length / minCount;
    results.push({
      key: "finding_count",
      score: countScore,
      comment: `Found ${String(findings.length)} findings (expected min: ${String(minCount)})`,
    });
  }

  // 2. Must-Include Findings Check
  const mustInclude = Array.isArray(referenceOutputs?.mustIncludeFindings)
    ? (referenceOutputs.mustIncludeFindings as ExpectedFinding[])
    : [];
  const invalidPatterns: string[] = [];

  if (mustInclude.length > 0) {
    let matchedCount = 0;

    for (const expected of mustInclude) {
      const matched = findings.some((f) => {
        const categoryMatch = f.category.toLowerCase() === expected.category.toLowerCase();
        const severityMatch =
          severityToNumber(f.severity) >= severityToNumber(expected.severityMin);
        const titleResult = safeRegexTest(f.title, expected.titlePattern);
        if (titleResult.error) {
          invalidPatterns.push(titleResult.error);
        }
        return categoryMatch && severityMatch && titleResult.matches;
      });
      if (matched) matchedCount++;
    }

    const baseComment = `Matched ${String(matchedCount)}/${String(mustInclude.length)} required findings`;
    const uniqueErrors = [...new Set(invalidPatterns)];
    const comment =
      uniqueErrors.length > 0 ? `${baseComment}. Warning: ${uniqueErrors.join("; ")}` : baseComment;

    results.push({
      key: "required_findings",
      score: matchedCount / mustInclude.length,
      comment,
    });
  }

  // 3. Finding Quality - check that findings have descriptions
  if (findings.length > 0) {
    const withDescriptions = findings.filter((f) => f.description && f.description.length > 20);
    const qualityScore = withDescriptions.length / findings.length;

    results.push({
      key: "finding_quality",
      score: qualityScore,
      comment: `${String(withDescriptions.length)}/${String(findings.length)} findings have detailed descriptions`,
    });
  }

  // 4. Severity Distribution - check for variety (not all low/info)
  if (findings.length > 0) {
    const severityCounts: Partial<Record<Severity, number>> = {};
    for (const f of findings) {
      severityCounts[f.severity] = (severityCounts[f.severity] ?? 0) + 1;
    }

    const criticalCount = severityCounts.critical ?? 0;
    const highCount = severityCounts.high ?? 0;
    const mediumCount = severityCounts.medium ?? 0;
    const highOrAbove = criticalCount + highCount + mediumCount;
    const hasActionable = highOrAbove > 0;

    results.push({
      key: "actionable_findings",
      score: hasActionable ? 1 : 0,
      comment: hasActionable
        ? `Found ${String(highOrAbove)} medium+ severity findings`
        : "No actionable (medium+) findings",
    });
  }

  return results;
}
