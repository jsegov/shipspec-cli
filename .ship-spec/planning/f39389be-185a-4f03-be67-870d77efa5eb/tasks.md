<!-- ⚠️ GENERATED FILE: UNTRUSTED CONTENT -->
<!-- This file contains AI-generated content. Review carefully before clicking links. -->

> **⚠️ SECURITY NOTICE**
> This is an AI-generated document. Review all content before use.

### Task 1:
```
Implement the core types and schema for the Agent Evaluation Framework in `src/evals/types.ts`. 

Context: We need a standardized way to define 'Golden Scenarios' for testing our LangGraph agents. 

Steps:
1. Create `src/evals/types.ts`.
2. Define `EvalExampleSchema` using Zod as per the tech spec, including `input` (command, context, repo_state) and `expected` (tools_called, required_sections, forbidden_patterns, reference_output).
3. Export the `EvalExample` type inferred from the schema.
4. Add a `RunResult` interface to track the outcome of an evaluation (score, latency, trace_url).

Acceptance Criteria:
- The file exports a valid Zod schema and TypeScript types.
- The schema correctly validates the example JSON provided in the tech spec.
```

### Task 2:
```
Create the LangSmith Dataset Manager in `src/evals/dataset.ts`. 

Context: This module handles programmatic creation and synchronization of test datasets with LangSmith.

Steps:
1. Initialize the LangSmith `Client` from the `langsmith` package.
2. Implement a function `syncGoldenDataset(examples: EvalExample[])` that checks if a dataset named 'Ship-Spec-Golden-Set' exists; if not, create it.
3. Implement logic to upload or update examples in the dataset.
4. Ensure `LANGSMITH_API_KEY` is retrieved from environment variables.

Acceptance Criteria:
- A developer can call a function to push local JSON fixtures to LangSmith.
- The code handles existing datasets gracefully without duplication.
```

### Task 3:
```
Implement Custom Evaluators in `src/evals/evaluators/`. 

Context: We need logic to score agent outputs against the 'expected' criteria in our Golden Dataset.

Steps:
1. Create `src/evals/evaluators/tool-evaluator.ts`: Compare `state.steps` from the agent run against `expected.tools_called`.
2. Create `src/evals/evaluators/schema-evaluator.ts`: Verify the final Markdown output contains all `required_sections` and none of the `forbidden_patterns`.
3. Create `src/evals/evaluators/accuracy-evaluator.ts`: Use LangChain's `QA` evaluator with an LLM (Gemini Flash) to compare the agent's output with the `reference_output`.

Acceptance Criteria:
- Each evaluator returns a score between 0 and 1.
- Evaluators are unit-testable with mock data.
```

### Task 4:
```
Implement the Eval Runner in `src/evals/runner.ts`. 

Context: This is the orchestrator that executes the agent workflows and triggers evaluators.

Steps:
1. Use `p-limit` to set a default concurrency of 3.
2. Implement a `runEvalSuite()` function that: 
   - Fetches examples from LangSmith.
   - For each example, sets up a temporary environment in `test/tmp/evals/`.
   - Invokes the relevant LangGraph workflow (`planning` or `productionalize`).
   - Ensures `LANGCHAIN_TRACING_V2=true` and uses `redactObject` on all inputs/outputs before tracing.
   - Runs the evaluators created in Task 3.
3. Aggregate results into a summary object.

Acceptance Criteria:
- The runner executes multiple tests in parallel up to the limit.
- Traces are correctly grouped under a project name in LangSmith.
```

### Task 5:
```
Add the `ship-spec dev eval` command to the CLI. 

Context: Developers need a way to run evaluations locally and sync datasets.

Steps:
1. Update the CLI entry point to include a `dev` command group.
2. Implement `ship-spec dev eval` which triggers the `runEvalSuite()` from `src/evals/runner.ts`.
3. Implement the `--push` flag to trigger `syncGoldenDataset()`.
4. Ensure the command outputs a summary table of results and the LangSmith project URL to the terminal.

Acceptance Criteria:
- Running `ship-spec dev eval` executes the full pipeline locally.
- Results are printed clearly in the console.
```

### Task 6:
```
Create the GitHub Actions workflow for automated evaluations in `.github/workflows/evals.yml`. 

Context: We need to prevent regressions by running evals on every Pull Request.

Steps:
1. Define a workflow triggered on `pull_request` to specific branches.
2. Set up environment variables for `LANGSMITH_API_KEY`, `OPENROUTER_API_KEY`, etc.
3. Run `npm install` and `ship-spec dev eval`.
4. Implement a post-run script that parses the evaluation results and uses the GitHub API to post a Markdown summary comment on the PR.

Acceptance Criteria:
- The workflow fails if the evaluation pass rate falls below a defined threshold.
- A summary report appears as a comment on the PR.
```