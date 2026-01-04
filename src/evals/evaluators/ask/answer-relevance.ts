/**
 * Evaluators for ask workflow answer relevance.
 */
import type { EvaluatorParams, EvaluationResult } from "../../types.js";

/**
 * Evaluates the relevance of answers to questions.
 * Checks for:
 * - Topic coverage (expected topics mentioned)
 * - Hallucination guard (forbidden terms absent)
 * - Answer substance (not too short)
 */
export function answerRelevanceEvaluator({
  inputs,
  outputs,
  referenceOutputs,
}: EvaluatorParams): EvaluationResult[] {
  const answer = typeof outputs.answer === "string" ? outputs.answer : "";
  const question = typeof inputs.question === "string" ? inputs.question : "";
  const results: EvaluationResult[] = [];

  // 1. Expected Topics Coverage
  const expectedTopics = Array.isArray(referenceOutputs?.expectedTopics)
    ? (referenceOutputs.expectedTopics as string[])
    : [];
  if (expectedTopics.length > 0) {
    const answerLower = answer.toLowerCase();
    const topicsCovered = expectedTopics.filter((topic) =>
      answerLower.includes(topic.toLowerCase())
    );
    const coverageScore = topicsCovered.length / expectedTopics.length;

    results.push({
      key: "topic_coverage",
      score: coverageScore,
      comment: `Covered ${String(topicsCovered.length)}/${String(expectedTopics.length)} expected topics`,
    });
  }

  // 2. Hallucination Guard - check for forbidden terms
  const mustNotContain = Array.isArray(referenceOutputs?.mustNotContain)
    ? (referenceOutputs.mustNotContain as string[])
    : [];
  const hallucinations = mustNotContain.filter((term) =>
    answer.toLowerCase().includes(term.toLowerCase())
  );

  results.push({
    key: "no_hallucination",
    score: hallucinations.length === 0 ? 1 : 0,
    comment:
      hallucinations.length > 0
        ? `Found hallucination indicators: ${hallucinations.join(", ")}`
        : "No hallucination indicators detected",
  });

  // 3. Answer Contains Required Content
  const answerContains = Array.isArray(referenceOutputs?.answerContains)
    ? (referenceOutputs.answerContains as string[])
    : [];
  if (answerContains.length > 0) {
    const answerLower = answer.toLowerCase();
    const termsFound = answerContains.filter((term) => answerLower.includes(term.toLowerCase()));
    const contentScore = termsFound.length / answerContains.length;

    results.push({
      key: "required_content",
      score: contentScore,
      comment: `Found ${String(termsFound.length)}/${String(answerContains.length)} required terms`,
    });
  }

  // 4. Answer Substance - not too short
  const wordCount = answer.split(/\s+/).length;
  const hasSubstance = wordCount >= 20;

  results.push({
    key: "answer_substance",
    score: hasSubstance ? 1 : wordCount / 20,
    comment: `Answer contains ${String(wordCount)} words`,
  });

  // 5. Question Relevance - simple check that answer relates to question keywords
  const questionWords = question
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const answerLower = answer.toLowerCase();
  const relevantWords = questionWords.filter((w) => answerLower.includes(w));
  const relevanceScore = questionWords.length > 0 ? relevantWords.length / questionWords.length : 1;

  results.push({
    key: "question_relevance",
    score: Math.min(relevanceScore * 2, 1), // Scale up, cap at 1
    comment:
      relevanceScore > 0.3
        ? "Answer appears relevant to question"
        : "Answer may not address the question directly",
  });

  return results;
}
