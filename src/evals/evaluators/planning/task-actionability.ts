/**
 * Evaluators for planning task actionability.
 */
import type { EvaluatorParams, EvaluationResult } from "../../types.js";

/**
 * Action verbs that indicate actionable tasks.
 */
const ACTIONABLE_VERBS = [
  "implement",
  "create",
  "add",
  "update",
  "fix",
  "configure",
  "build",
  "write",
  "design",
  "refactor",
  "test",
  "deploy",
  "integrate",
  "setup",
  "remove",
  "migrate",
];

/**
 * Evaluates the actionability of generated task prompts.
 * Checks for:
 * - Task count meets expectations
 * - Tasks contain actionable verbs
 * - Tasks are specific (have file/component references)
 */
export function taskActionabilityEvaluator({
  outputs,
  referenceOutputs,
}: EvaluatorParams): EvaluationResult[] {
  const taskPrompts = typeof outputs.taskPrompts === "string" ? outputs.taskPrompts : "";
  const results: EvaluationResult[] = [];

  // Count individual tasks (supports bullet, numbered, or mixed list formats)
  const bulletTasks = (taskPrompts.match(/^[-*]\s+.+/gm) ?? []).length;
  const numberedTasks = (taskPrompts.match(/^\d+\.\s+.+/gm) ?? []).length;
  const taskCount = bulletTasks + numberedTasks;

  // 1. Task Count Check
  const expectedCount =
    typeof referenceOutputs?.taskPromptCount === "number" ? referenceOutputs.taskPromptCount : 3;
  const countScore = taskCount >= expectedCount ? 1 : taskCount / expectedCount;

  results.push({
    key: "task_count",
    score: countScore,
    comment: `Generated ${String(taskCount)} tasks (expected: ${String(expectedCount)})`,
  });

  // 2. Actionable Verbs Check
  const taskPromptsLower = taskPrompts.toLowerCase();
  const verbsFound = ACTIONABLE_VERBS.filter((verb) => taskPromptsLower.includes(verb));
  const hasActionableVerbs = verbsFound.length > 0;

  results.push({
    key: "task_actionability",
    score: hasActionableVerbs ? 1 : 0,
    comment: hasActionableVerbs
      ? `Tasks contain actionable verbs: ${verbsFound.slice(0, 3).join(", ")}...`
      : "Tasks lack actionable verbs",
  });

  // 3. Specificity Check - look for file paths, component names, etc.
  const hasFilePaths = /(?:src\/|\.ts|\.js|\.py|\.go|\.rs)/.test(taskPrompts);
  const hasComponentNames = /[A-Z][a-z]+(?:[A-Z][a-z]+)+/.test(taskPrompts);
  const isSpecific = hasFilePaths || hasComponentNames;

  results.push({
    key: "task_specificity",
    score: isSpecific ? 1 : 0.5,
    comment: isSpecific
      ? "Tasks reference specific files or components"
      : "Tasks could be more specific (no file paths or component names)",
  });

  // 4. Required Content in Tasks
  const taskPromptsMustContain = Array.isArray(referenceOutputs?.taskPromptsMustContain)
    ? (referenceOutputs.taskPromptsMustContain as string[])
    : [];
  const techSpecMustContain = Array.isArray(referenceOutputs?.techSpecMustContain)
    ? (referenceOutputs.techSpecMustContain as string[])
    : [];
  const mustContain =
    taskPromptsMustContain.length > 0 ? taskPromptsMustContain : techSpecMustContain;

  if (mustContain.length > 0) {
    const termsFound = mustContain.filter((term) => taskPromptsLower.includes(term.toLowerCase()));
    const contentScore = termsFound.length / mustContain.length;

    results.push({
      key: "task_required_content",
      score: contentScore,
      comment: `Found ${String(termsFound.length)}/${String(mustContain.length)} required terms in tasks`,
    });
  }

  return results;
}
