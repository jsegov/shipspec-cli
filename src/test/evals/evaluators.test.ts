import { describe, it, expect } from "vitest";

import {
  reportQualityEvaluator,
  findingAccuracyEvaluator,
} from "../../evals/evaluators/productionalize/index.js";
import {
  prdQualityEvaluator,
  specQualityEvaluator,
  taskActionabilityEvaluator,
} from "../../evals/evaluators/planning/index.js";
import {
  answerRelevanceEvaluator,
  citationAccuracyEvaluator,
} from "../../evals/evaluators/ask/index.js";
import { ExpectedFindingSchema } from "../../evals/datasets/schemas.js";

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

    it("should report 0 words for empty report", () => {
      const results = reportQualityEvaluator({
        inputs: { userQuery: "test" },
        outputs: { finalReport: "" },
        referenceOutputs: {},
      });

      const lengthResult = results.find((r) => r.key === "report_length");
      expect(lengthResult?.score).toBe(0);
      expect(lengthResult?.comment).toBe("Report contains 0 words");
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

    it("should handle invalid regex pattern without crashing", () => {
      // This should not throw, even with an invalid regex pattern
      const results = findingAccuracyEvaluator({
        inputs: {},
        outputs: {
          findings: [
            {
              id: "1",
              severity: "high",
              category: "security",
              title: "SQL Injection vulnerability",
              description: "Found SQL injection in user input",
            },
          ],
        },
        referenceOutputs: {
          mustIncludeFindings: [
            {
              category: "security",
              severityMin: "medium",
              titlePattern: "SQL[Injection", // Invalid regex - unclosed bracket
            },
          ],
        },
      });

      // Should complete without throwing
      expect(results).toBeDefined();
      const requiredResult = results.find((r) => r.key === "required_findings");
      expect(requiredResult).toBeDefined();
      // Score should be 0 since the invalid pattern can't match
      expect(requiredResult?.score).toBe(0);
      // Comment should include warning about invalid regex
      expect(requiredResult?.comment).toContain("Invalid regex");
    });

    it("should match valid titlePattern correctly", () => {
      const results = findingAccuracyEvaluator({
        inputs: {},
        outputs: {
          findings: [
            {
              id: "1",
              severity: "high",
              category: "security",
              title: "SQL Injection vulnerability found",
              description: "Found SQL injection in user input",
            },
          ],
        },
        referenceOutputs: {
          mustIncludeFindings: [
            {
              category: "security",
              severityMin: "medium",
              titlePattern: "SQL.*Injection", // Valid regex
            },
          ],
        },
      });

      const requiredResult = results.find((r) => r.key === "required_findings");
      expect(requiredResult?.score).toBe(1);
      expect(requiredResult?.comment).not.toContain("Invalid regex");
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

## Status
On Target

## Problem Statement
Users need a way to track their tasks.

## Background and Strategic Fit
This aligns with company goals.

## Goals
- Improve productivity
- Reduce friction

## Requirements
1. User can create tasks
2. User can mark tasks complete

## Success Metrics
- 50% adoption rate

## User Stories
As a user, I want to track tasks.

## UX Design
Key user flows documented.

## Non-Goals
Not building a calendar.

## Scope
Limited to task tracking.
          `,
        },
        referenceOutputs: {},
      });

      const sectionsResult = results.find((r) => r.key === "prd_sections");
      expect(sectionsResult?.score).toBeGreaterThanOrEqual(0.8);
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

    it("should report 0 words for empty PRD", () => {
      const results = prdQualityEvaluator({
        inputs: {},
        outputs: { prd: "" },
        referenceOutputs: {},
      });

      const lengthResult = results.find((r) => r.key === "prd_length");
      expect(lengthResult?.score).toBe(0);
      expect(lengthResult?.comment).toBe("PRD contains 0 words");
    });

    it("should detect requirement IDs (FR-XXX, NFR-XXX)", () => {
      const results = prdQualityEvaluator({
        inputs: {},
        outputs: {
          prd: `
## Functional Requirements
| ID | Description | Priority |
|----|-------------|----------|
| FR-001 | User can login | P0 |
| FR-002 | User can logout | P1 |

## Non-Functional Requirements
| ID | Description | Priority |
|----|-------------|----------|
| NFR-001 | Response time < 200ms | P0 |
          `,
        },
        referenceOutputs: {},
      });

      const reqIdResult = results.find((r) => r.key === "prd_requirement_ids");
      expect(reqIdResult?.score).toBe(1);
      expect(reqIdResult?.comment).toContain("2 FR IDs");
      expect(reqIdResult?.comment).toContain("1 NFR IDs");
    });

    it("should report 0 when no requirement IDs found", () => {
      const results = prdQualityEvaluator({
        inputs: {},
        outputs: {
          prd: "This is a PRD without any formal requirement IDs.",
        },
        referenceOutputs: {},
      });

      const reqIdResult = results.find((r) => r.key === "prd_requirement_ids");
      expect(reqIdResult?.score).toBe(0);
      expect(reqIdResult?.comment).toContain("No requirement IDs found");
    });

    it("should detect priority classification (P0, P1, P2)", () => {
      const results = prdQualityEvaluator({
        inputs: {},
        outputs: {
          prd: `
## Requirements
| Feature | Priority |
|---------|----------|
| Core auth | P0 |
| Email notifications | P1 |
| Dark mode | P2 |
          `,
        },
        referenceOutputs: {},
      });

      const priorityResult = results.find((r) => r.key === "prd_priority_classification");
      expect(priorityResult?.score).toBe(1);
      expect(priorityResult?.comment).toContain("3 priority levels");
    });

    it("should report partial score for incomplete priority classification", () => {
      const results = prdQualityEvaluator({
        inputs: {},
        outputs: {
          prd: "All features are P0 priority: login, logout, dashboard.",
        },
        referenceOutputs: {},
      });

      const priorityResult = results.find((r) => r.key === "prd_priority_classification");
      expect(priorityResult?.score).toBe(0.5); // Only 1 priority level found
    });

    it("should NOT match priority patterns inside words like HTTP2 or HTTP1", () => {
      const results = prdQualityEvaluator({
        inputs: {},
        outputs: {
          prd: `
This PRD discusses HTTP2 protocol support and HTTP1.1 fallback.
We also support HTTP/2 and HTTP/1.1 connections.
The MP3 decoder and EP2 endpoint will be implemented.
          `,
        },
        referenceOutputs: {},
      });

      const priorityResult = results.find((r) => r.key === "prd_priority_classification");
      expect(priorityResult?.score).toBe(0); // No actual P0/P1/P2 priorities
      expect(priorityResult?.comment).toContain("0 priority levels");
    });
  });

  describe("specQualityEvaluator", () => {
    it("should detect standard spec sections", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: {
          techSpec: `
# Technical Specification

## Overview
Building a user authentication system.

## Requirements Traceability Matrix
| ID | Component |
|----|-----------|

## Architecture
System design details.

## Data Models
Database schema.

## API Design
Endpoints.

## Implementation Plan
Tasks.

## Testing Strategy
Test approach.

## Risks
Risk analysis.

## Security
Security measures.

## Performance
Performance considerations.
          `,
        },
        referenceOutputs: {},
      });

      const sectionsResult = results.find((r) => r.key === "spec_sections");
      expect(sectionsResult?.score).toBe(1); // All 10 sections found
    });

    it("should detect Requirements Traceability Matrix", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: {
          techSpec: `
## Requirements Traceability Matrix
| Requirement ID | Description | Component |
|----------------|-------------|-----------|
| FR-001 | Login | AuthModule |
          `,
        },
        referenceOutputs: {},
      });

      const rtmResult = results.find((r) => r.key === "spec_rtm");
      expect(rtmResult?.score).toBe(1);
      expect(rtmResult?.comment).toContain("Requirements Traceability Matrix");
    });

    it("should report missing RTM", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: {
          techSpec: "# Tech Spec\n\nNo traceability here.",
        },
        referenceOutputs: {},
      });

      const rtmResult = results.find((r) => r.key === "spec_rtm");
      expect(rtmResult?.score).toBe(0);
      expect(rtmResult?.comment).toContain("Missing");
    });

    it("should give partial score for RTM header without table", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: {
          techSpec: `
# Tech Spec

## Requirements Traceability Matrix

This section describes how requirements map to implementation.
No actual table here.
          `,
        },
        referenceOutputs: {},
      });

      const rtmResult = results.find((r) => r.key === "spec_rtm");
      expect(rtmResult?.score).toBe(0.5);
      expect(rtmResult?.comment).toBe("Has RTM header but missing table formatting");
    });

    it("should give partial score for table without RTM header", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: {
          techSpec: `
# Tech Spec

## Some Other Section

| Column A | Column B | Column C |
|----------|----------|----------|
| Value 1  | Value 2  | Value 3  |
          `,
        },
        referenceOutputs: {},
      });

      const rtmResult = results.find((r) => r.key === "spec_rtm");
      expect(rtmResult?.score).toBe(0.5);
      expect(rtmResult?.comment).toBe("Has table but missing RTM header");
    });

    it("should detect inline requirement references [Fulfills: ...]", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: {
          techSpec: `
## Architecture
[Fulfills: FR-001, FR-002]
Component design here.

## API Design
[Fulfills: FR-003, NFR-001]
API endpoints.

## Testing
[Fulfills: FR-001]
Test strategy.
          `,
        },
        referenceOutputs: {},
      });

      const inlineResult = results.find((r) => r.key === "spec_inline_refs");
      expect(inlineResult?.score).toBe(1);
      expect(inlineResult?.comment).toContain("3 inline requirement references");
    });

    it("should count unique requirements referenced", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: {
          techSpec: `
[Fulfills: FR-001, FR-002, FR-003, FR-004, NFR-001, NFR-002]
This spec references multiple requirements.
          `,
        },
        referenceOutputs: {},
      });

      const coverageResult = results.find((r) => r.key === "spec_requirement_coverage");
      expect(coverageResult?.score).toBe(1);
      expect(coverageResult?.comment).toContain("6 unique requirements");
    });

    it("should detect test coverage matrix", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: {
          techSpec: `
## Test Coverage Matrix
| FR-001 | Yes | No | Yes |
| NFR-001 | Yes | Yes | No |
          `,
        },
        referenceOutputs: {},
      });

      const testMatrixResult = results.find((r) => r.key === "spec_test_matrix");
      expect(testMatrixResult?.score).toBe(1);
    });

    it("should report 0 words for empty spec", () => {
      const results = specQualityEvaluator({
        inputs: {},
        outputs: { techSpec: "" },
        referenceOutputs: {},
      });

      const lengthResult = results.find((r) => r.key === "spec_length");
      expect(lengthResult?.score).toBe(0);
      expect(lengthResult?.comment).toBe("Tech spec contains 0 words");
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

    it("should count mixed bullet and numbered tasks correctly", () => {
      // Regression test: ensure mixed list formats are summed, not max'd
      const results = taskActionabilityEvaluator({
        inputs: {},
        outputs: {
          taskPrompts: `
## Setup Phase
- Install dependencies
- Configure environment

## Implementation Phase
1. Create the auth module
2. Add API routes
3. Write integration tests
          `,
        },
        referenceOutputs: { taskPromptCount: 5 },
      });

      const countResult = results.find((r) => r.key === "task_count");
      expect(countResult?.score).toBe(1);
      expect(countResult?.comment).toContain("5 tasks");
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

    it("should report 0 words for empty answer", () => {
      const results = answerRelevanceEvaluator({
        inputs: { question: "What is this?" },
        outputs: { answer: "" },
        referenceOutputs: {},
      });

      const substanceResult = results.find((r) => r.key === "answer_substance");
      expect(substanceResult?.score).toBe(0);
      expect(substanceResult?.comment).toBe("Answer contains 0 words");
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

describe("Dataset Schema Validation", () => {
  describe("ExpectedFindingSchema", () => {
    it("should accept valid regex pattern", () => {
      const result = ExpectedFindingSchema.safeParse({
        category: "security",
        severityMin: "high",
        titlePattern: "SQL.*Injection",
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid regex pattern", () => {
      const result = ExpectedFindingSchema.safeParse({
        category: "security",
        severityMin: "high",
        titlePattern: "SQL[Injection", // Invalid - unclosed bracket
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain("Invalid regex");
      }
    });

    it("should accept missing titlePattern", () => {
      const result = ExpectedFindingSchema.safeParse({
        category: "security",
        severityMin: "medium",
      });

      expect(result.success).toBe(true);
    });
  });
});
