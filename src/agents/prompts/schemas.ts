import { z } from "zod";
import type { TaskmasterTask } from "../productionalize/types.js";

export const ReasoningSchema = z.object({
  reasoning: z.string().describe("Chain-of-thought reasoning trace explaining the agent's logic"),
});

export const SpecSubtaskSchema = z.object({
  id: z.string(),
  query: z.string().describe("Specific question to investigate"),
  reasoning: z.string().describe("Why this subtask is necessary and what it aims to discover"),
});

export const SpecPlanSchema = z.object({
  reasoning: z.string().describe("Overall strategy for decomposing the user request"),
  subtasks: z.array(SpecSubtaskSchema).nonempty().min(1),
});

export const ProductionalizeSubtaskSchema = z.object({
  id: z.string(),
  category: z.string().describe("The production-readiness category (e.g., security, soc2, testing)"),
  query: z.string().describe("The specific investigation query"),
  source: z.enum(["code", "web", "scan"]).describe("The data source to use for this subtask"),
  rationale: z.string().describe("Reasoning for this subtask grounded in project signals and research"),
});

export const ProductionalizePlanSchema = z.object({
  reasoning: z.string().describe("Analysis of project signals and research to inform the plan"),
  subtasks: z.array(ProductionalizeSubtaskSchema),
});

export const CodeRefSchema = z.object({
  filepath: z.string(),
  lines: z.string(),
  content: z.string(),
});

export const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  complianceRefs: z.array(z.string()).describe("References to compliance controls (e.g., SOC 2 CC6.1, OWASP A01)"),
  evidence: z.object({
    codeRefs: z.array(CodeRefSchema),
    links: z.array(z.string()),
  }),
});

export const SpecWorkerOutputSchema = z.object({
  reasoning: z.string().describe("Detailed analysis of the provided context"),
  summary: z.string().describe("Concise technical summary answering the query"),
  confidenceLevel: z.enum(["high", "medium", "low"]).describe("Confidence in the analysis based on context quality"),
  missingContext: z.array(z.string()).optional().describe("List of information that was missing or couldn't be analyzed"),
});

export const ProductionalizeWorkerOutputSchema = z.object({
  reasoning: z.string().describe("Detailed analysis of the provided context"),
  findings: z.array(FindingSchema),
  summary: z.string().describe("Concise technical summary of findings"),
  confidenceLevel: z.enum(["high", "medium", "low"]).describe("Confidence in the findings based on context quality"),
});

export const TaskmasterTaskSchema: z.ZodType<TaskmasterTask> = z.lazy(() =>
  z.object({
    id: z.number(),
    title: z.string(),
    description: z.string(),
    status: z.literal("pending"),
    priority: z.enum(["high", "medium", "low"]),
    dependencies: z.array(z.number()),
    details: z.string(),
    effort: z.enum(["1-2h", "4-8h", "16h+"]).describe("Estimated implementation effort"),
    acceptanceCriteria: z.array(z.string()).describe("Specific, testable conditions for task completion"),
    dependencyRationale: z.string().describe("Explanation for why dependencies exist (use empty string if none)"),
    testStrategy: z.string(),
    subtasks: z.array(TaskmasterTaskSchema).describe("Nested subtasks (use empty array if none)"),
  })
);

export const TasksOutputSchema = z.object({
  reasoning: z.string().describe("Architecture and dependency analysis for the task list"),
  tasks: z.array(TaskmasterTaskSchema),
});

