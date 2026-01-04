import { describe, it, expect } from "vitest";

import {
  reportQualityEvaluator,
  findingAccuracyEvaluator,
} from "../../evals/evaluators/productionalize/index.js";
import {
  prdQualityEvaluator,
  taskActionabilityEvaluator,
} from "../../evals/evaluators/planning/index.js";
import {
  answerRelevanceEvaluator,
  citationAccuracyEvaluator,
} from "../../evals/evaluators/ask/index.js";

describe("Productionalize Evaluators", () => {
  describe("reportQualityEvaluator", () => {
    it("should score report with executive summary as 1", () => {
      const results = reportQualityEvaluator({
        inputs: { userQuery: "analyze this codebase" },
        outputs: {
          finalReport: "## Executive Summary\n\nThis is a production readiness report.",
        },
        referenceOutputs: { expectedCategories: ["security"] },
      });

      const structureResult = results.find((r) => r.key === "report_structure");
      expect(structureResult?.score).toBe(1);
      expect(structureResult?.comment).toContain("executive summary");
    });

    it("should score missing executive summary as 0", () => {
      const results = reportQualityEvaluator({
        inputs: { userQuery: "test" },
        outputs: { finalReport: "# Report\n\nNo summary section here." },
        referenceOutputs: { expectedCategories: [] },
      });

      const structureResult = results.find((r) => r.key === "report_structure");
      expect(structureResult?.score).toBe(0);
    });

    it("should calculate category coverage correctly", () => {
      const results = reportQualityEvaluator({
        inputs: { userQuery: "test" },
        outputs: {
          finalReport: "## Summary\n\nThis report covers security and testing aspects.",
        },
        referenceOutputs: {
          expectedCategories: ["security", "testing", "performance", "documentation"],
        },
      });

      const coverageResult = results.find((r) => r.key === "category_coverage");
      expect(coverageResult?.score).toBe(0.5); // 2 out of 4
      expect(coverageResult?.comment).toContain("2/4");
    });

    it("should check required content terms", () => {
      const results = reportQualityEvaluator({
        inputs: { userQuery: "test" },
        outputs: {
          finalReport: "## Summary\n\nThis report discusses authentication and API security.",
        },
        referenceOutputs: {
          reportMustContain: ["authentication", "API", "database"],
        },
      });

      const contentResult = results.find((r) => r.key === "required_content");
      expect(contentResult?.score).toBeCloseTo(0.667, 2); // 2 out of 3
    });
  });

  describe("findingAccuracyEvaluator", () => {
    it("should score finding count correctly", () => {
      const results = findingAccuracyEvaluator({
        inputs: {},
        outputs: {
          findings: [
            {
              id: "1",
              severity: "high",
              category: "security",
              title: "SQL Injection",
              description: "Found SQL injection vulnerability",
            },
            {
              id: "2",
              severity: "medium",
              category: "security",
              title: "XSS",
              description: "Found XSS vulnerability in form",
            },
          ],
        },
        referenceOutputs: { minFindingCount: 2 },
      });

      const countResult = results.find((r) => r.key === "finding_count");
      expect(countResult?.score).toBe(1);
    });

    it("should score below minimum finding count proportionally", () => {
      const results = findingAccuracyEvaluator({
        inputs: {},
        outputs: {
          findings: [
            {
              id: "1",
              severity: "low",
              category: "code-quality",
              title: "Unused variable",
              description: "Found unused variable",
            },
          ],
        },
        referenceOutputs: { minFindingCount: 5 },
      });

      const countResult = results.find((r) => r.key === "finding_count");
      expect(countResult?.score).toBe(0.2); // 1 out of 5
    });

    it("should match required findings by category and severity", () => {
      const results = findingAccuracyEvaluator({
        inputs: {},
        outputs: {
          findings: [
            {
              id: "1",
              severity: "critical",
              category: "security",
              title: "Auth bypass",
              description: "Authentication bypass found",
            },
            {
              id: "2",
              severity: "low",
              category: "testing",
              title: "No tests",
              description: "No unit tests found",
            },
          ],
        },
        referenceOutputs: {
          mustIncludeFindings: [
            { category: "security", severityMin: "high" },
            { category: "testing", severityMin: "low" },
            { category: "dependencies", severityMin: "medium" },
          ],
        },
      });

      const requiredResult = results.find((r) => r.key === "required_findings");
      expect(requiredResult?.score).toBeCloseTo(0.667, 2); // 2 out of 3
    });
  });
});

describe("Planning Evaluators", () => {
  describe("prdQualityEvaluator", () => {
    it("should detect standard PRD sections", () => {
      const results = prdQualityEvaluator({
        inputs: {},
        outputs: {
          prd: `
# Product Requirements Document

## Problem Statement
Users need a way to track their tasks.

## Goals
- Improve productivity
- Reduce friction

## Requirements
1. User can create tasks
2. User can mark tasks complete

## Success Metrics
- 50% adoption rate
          `,
        },
        referenceOutputs: {},
      });

      const sectionsResult = results.find((r) => r.key === "prd_sections");
      expect(sectionsResult?.score).toBeGreaterThanOrEqual(0.5);
    });

    it("should check for required content", () => {
      const results = prdQualityEvaluator({
        inputs: {},
        outputs: {
          prd: "This PRD discusses OAuth2 authentication and user management with React frontend.",
        },
        referenceOutputs: {
          prdMustContain: ["OAuth2", "authentication", "PostgreSQL"],
        },
      });

      const contentResult = results.find((r) => r.key === "prd_required_content");
      expect(contentResult?.score).toBeCloseTo(0.667, 2); // 2 out of 3
    });
  });

  describe("taskActionabilityEvaluator", () => {
    it("should count tasks correctly", () => {
      const results = taskActionabilityEvaluator({
        inputs: {},
        outputs: {
          taskPrompts: `
## Tasks

- Implement user authentication
- Create database schema
- Add API endpoints
- Write unit tests
          `,
        },
        referenceOutputs: { taskPromptCount: 4 },
      });

      const countResult = results.find((r) => r.key === "task_count");
      expect(countResult?.score).toBe(1);
    });

    it("should detect actionable verbs", () => {
      const results = taskActionabilityEvaluator({
        inputs: {},
        outputs: {
          taskPrompts: "- Implement the login flow\n- Create user model\n- Fix the bug in checkout",
        },
        referenceOutputs: {},
      });

      const actionabilityResult = results.find((r) => r.key === "task_actionability");
      expect(actionabilityResult?.score).toBe(1);
      expect(actionabilityResult?.comment).toContain("actionable verbs");
    });

    it("should detect file path specificity", () => {
      const results = taskActionabilityEvaluator({
        inputs: {},
        outputs: {
          taskPrompts: "- Update src/components/Auth.tsx to add OAuth\n- Fix bug in api/users.ts",
        },
        referenceOutputs: {},
      });

      const specificityResult = results.find((r) => r.key === "task_specificity");
      expect(specificityResult?.score).toBe(1);
    });
  });
});

describe("Ask Evaluators", () => {
  describe("answerRelevanceEvaluator", () => {
    it("should calculate topic coverage", () => {
      const results = answerRelevanceEvaluator({
        inputs: { question: "How does authentication work?" },
        outputs: {
          answer:
            "The authentication system uses JWT tokens and middleware to verify user sessions.",
        },
        referenceOutputs: {
          expectedTopics: ["authentication", "JWT", "middleware", "sessions", "OAuth"],
        },
      });

      const coverageResult = results.find((r) => r.key === "topic_coverage");
      expect(coverageResult?.score).toBe(0.8); // 4 out of 5
    });

    it("should detect hallucination indicators", () => {
      const results = answerRelevanceEvaluator({
        inputs: { question: "How does the API work?" },
        outputs: {
          answer: "I don't know anything about this codebase. There is no information available.",
        },
        referenceOutputs: {
          mustNotContain: ["I don't know", "no information"],
        },
      });

      const hallucinationResult = results.find((r) => r.key === "no_hallucination");
      expect(hallucinationResult?.score).toBe(0);
      expect(hallucinationResult?.comment).toContain("hallucination");
    });

    it("should pass hallucination check for good answers", () => {
      const results = answerRelevanceEvaluator({
        inputs: { question: "How does routing work?" },
        outputs: {
          answer: "The routing is handled by Express.js in the routes/ directory.",
        },
        referenceOutputs: {
          mustNotContain: ["I don't know", "cannot help"],
        },
      });

      const hallucinationResult = results.find((r) => r.key === "no_hallucination");
      expect(hallucinationResult?.score).toBe(1);
    });
  });

  describe("citationAccuracyEvaluator", () => {
    it("should detect required file citations", () => {
      const results = citationAccuracyEvaluator({
        inputs: {},
        outputs: {
          answer:
            "The auth logic is in `src/auth/middleware.ts` and uses the config from `src/config/auth.ts`.",
        },
        referenceOutputs: {
          mustCiteFiles: ["middleware.ts", "auth.ts", "users.ts"],
        },
      });

      const citationsResult = results.find((r) => r.key === "required_citations");
      expect(citationsResult?.score).toBeCloseTo(0.667, 2); // 2 out of 3
    });

    it("should detect presence of code citations", () => {
      const results = citationAccuracyEvaluator({
        inputs: {},
        outputs: {
          answer: "See `src/api/routes.ts` for the implementation.",
        },
        referenceOutputs: {},
      });

      const hasCitationsResult = results.find((r) => r.key === "has_citations");
      expect(hasCitationsResult?.score).toBe(1);
    });

    it("should detect missing citations", () => {
      const results = citationAccuracyEvaluator({
        inputs: {},
        outputs: {
          answer: "The application uses a standard MVC architecture with controllers and models.",
        },
        referenceOutputs: {},
      });

      const hasCitationsResult = results.find((r) => r.key === "has_citations");
      expect(hasCitationsResult?.score).toBe(0);
    });

    it("should detect code examples", () => {
      const results = citationAccuracyEvaluator({
        inputs: {},
        outputs: {
          answer: "Here's an example:\n```typescript\nconst user = await getUser(id);\n```",
        },
        referenceOutputs: {},
      });

      const codeExamplesResult = results.find((r) => r.key === "has_code_examples");
      expect(codeExamplesResult?.score).toBe(1);
    });
  });
});
