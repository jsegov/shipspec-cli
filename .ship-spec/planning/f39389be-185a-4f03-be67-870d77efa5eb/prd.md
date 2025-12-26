<!-- ⚠️ GENERATED FILE: UNTRUSTED CONTENT -->
<!-- This file contains AI-generated content. Review carefully before clicking links. -->

> **⚠️ SECURITY NOTICE**
> This is an AI-generated document. Review all content before use.

# Product Requirements Document: Agent Evaluation Framework

## 1. Problem Statement
As the Ship Spec CLI evolves into a complex multi-agent system (using LangGraph.js), it becomes increasingly difficult to verify that changes to prompts, model selections, or retrieval logic improve—rather than degrade—the quality of analysis. 

Manual verification of the `planning` and `productionalize` commands is slow, expensive, and inconsistent. We need a systematic way to measure agent performance, detect regressions in task decomposition, and ensure the reliability of sub-agents (Researcher, SAST, Planner, Worker, Aggregator) before merging code.

## 2. Target Users
- **Core Contributors:** To validate PRs and optimize agent prompts.
- **Maintainers:** To monitor model performance across different providers (OpenRouter/Ollama).
- **DevOps/CI:** To provide automated quality gates for agentic workflows.

## 3. User Stories
- **As a Developer**, I want to run a suite of evaluations on my PR so that I can see if my prompt changes improved the Planner's accuracy.
- **As a Maintainer**, I want to see LangSmith traces for every evaluation run so that I can debug why a specific sub-agent failed a task.
- **As a Contributor**, I want to add new "Golden Scenarios" to the dataset so that the system remains robust as we support new languages or frameworks.

## 4. Features & Requirements

### Core Features (Must Have)
#### 4.1 LangSmith Integration
- **Trace Uploads:** Automatically upload traces of all evaluation runs to LangSmith.
- **Dataset Management:** Programmatic creation and versioning of "Golden Datasets" within LangSmith.
- **Evaluators:** Implementation of LangChain/LangSmith evaluators for:
    - **QA Accuracy:** Comparing agent output against reference answers.
    - **Tool Selection:** Verifying the Planner selects the correct tools (e.g., SAST vs. Web Search).
    - **Schema Adherence:** Ensuring sub-agents return valid Zod-compliant JSON.

#### 4.2 The "Golden Dataset" (Initial Seed)
A collection of inputs and expected outputs based on the `ship-spec` repository itself, covering:
- **Planning Command:**
    - *Task:* "Add a new command to export reports to PDF."
    - *Expected:* Decomposition into `fs` operations, `pdf-lib` research, and CLI entry point modification.
- **Productionalize Command:**
    - *Task:* "Analyze this repo for SOC 2 compliance."
    - *Expected:* Researcher identifies SOC 2 criteria; SAST identifies credential patterns; Aggregator synthesizes a report.

#### 4.3 Sub-Agent Unit Evaluations
Specific eval criteria for each node in the `productionalize` graph:
- **Researcher:** Relevance of web search results to the provided context.
- **SAST:** Recall rate (did it find the intentional "leaked" keys in test fixtures?).
- **Planner:** Correctness of task routing (assigning code tasks to Worker vs. compliance tasks to Researcher).
- **Worker:** Context pruning efficiency (did it use the minimum tokens necessary?).
- **Aggregator:** Synthesis quality (no hallucinations, correct Markdown formatting).

#### 4.4 Separate Evals Pipeline
- **GitHub Action:** A new workflow `.github/workflows/evals.yml` triggered on PRs.
- **Environment Isolation:** Uses a dedicated `evals` environment with `LANGSMITH_API_KEY` and `OPENROUTER_API_KEY`.
- **Reporting:** Uploads traces to LangSmith and provides a link in the GitHub PR summary.

### Secondary Features (Nice to Have)
- **Cost Tracking:** Report the estimated USD cost of the eval run in the PR comment.
- **Ollama Evals:** Ability to run the same eval suite against local models to compare performance vs. cloud models.

## 5. Success Metrics
- **Task Decomposition Accuracy:** >90% match with "Golden" tool selection.
- **Hallucination Rate:** <5% (measured via LangSmith's `faithfulness` evaluator).
- **Regression Detection:** 100% of PRs must pass the "Golden" baseline before merging.
- **Eval Latency:** Full suite should complete in <10 minutes.

## 6. Non-Goals / Out of Scope
- **Real-time Monitoring:** This PRD focuses on pre-merge evals, not production monitoring of end-user runs.
- **Automated Prompt Optimization:** We are not yet implementing DSPy-style auto-tuning.
- **UI for Evals:** We will rely entirely on the LangSmith web interface.

## 7. Constraints & Assumptions
- **Constraint:** Evals must not run on every commit to save costs; they should run on PR synchronization or manual trigger.
- **Assumption:** The repository will always have a valid `shipspec.json` or environment variables for model access.
- **Technical Constraint:** Must use `LangGraph.js` compatible tracing.

## 8. Implementation Plan: Standard Tasks for Dataset
To make the system extensible, we will define a `StandardTask` interface for the Golden Dataset:
1. **Refactoring Task:** "Move all Zod schemas from `src/config/schema.ts` to a new `src/core/validation/` directory."
2. **Feature Addition Task:** "Implement a `--json` flag for the `config` command."
3. **Security Task:** "Check if the `web-search.ts` tool is vulnerable to prompt injection."

## 9. Open Questions
- **Rate Limiting:** How many concurrent evals can we run on OpenRouter before hitting 429s? (Action: Implement `p-limit` in the eval runner).
- **Data Privacy:** Should we scrub local file paths from traces before uploading to LangSmith? (Action: Use the existing `redactObject` utility).