/**
 * Shared types for the evaluation framework.
 */

/**
 * Result returned by an evaluator function.
 */
export interface EvaluationResult {
  key: string;
  score: number;
  comment?: string;
}

/**
 * Parameters passed to evaluator functions.
 */
export interface EvaluatorParams {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  referenceOutputs?: Record<string, unknown>;
}

/**
 * A function that evaluates outputs against expected results.
 * Can be sync or async.
 */
export type Evaluator = (
  params: EvaluatorParams
) => EvaluationResult[] | Promise<EvaluationResult[]>;

/**
 * Workflow types that can be evaluated.
 */
export type EvalWorkflow = "productionalize" | "planning" | "ask";

/**
 * Severity levels for findings (mirrors productionalize types).
 */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/**
 * Converts severity string to numeric value for comparison.
 */
export function severityToNumber(severity: Severity): number {
  const severityMap: Record<Severity, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    info: 1,
  };
  return severityMap[severity];
}
