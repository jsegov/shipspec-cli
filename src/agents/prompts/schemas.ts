import { z } from "zod";

export const ReasoningSchema = z.object({
  reasoning: z.string().describe("Chain-of-thought reasoning trace explaining the agent's logic"),
});

export const ProductionalizeSubtaskSchema = z.object({
  id: z.string(),
  category: z
    .string()
    .describe("The production-readiness category (e.g., security, soc2, testing)"),
  query: z.string().describe("The specific investigation query"),
  source: z.enum(["code", "web", "scan"]).describe("The data source to use for this subtask"),
  rationale: z
    .string()
    .describe("Reasoning for this subtask grounded in project signals and research"),
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
  complianceRefs: z
    .array(z.string())
    .describe("References to compliance controls (e.g., SOC 2 CC6.1, OWASP A01)"),
  evidence: z.object({
    codeRefs: z.array(CodeRefSchema),
    links: z.array(z.string()),
  }),
});

export const ProductionalizeWorkerOutputSchema = z.object({
  reasoning: z.string().describe("Detailed analysis of the provided context"),
  findings: z.array(FindingSchema),
  summary: z.string().describe("Concise technical summary of findings"),
  confidenceLevel: z
    .enum(["high", "medium", "low"])
    .describe("Confidence in the findings based on context quality"),
});

export const PromptTaskSchema = z.object({
  id: z.number(),
  prompt: z
    .string()
    .describe("Agent-ready system prompt with file references and implementation steps"),
});

export const PromptsOutputSchema = z.object({
  reasoning: z.string().describe("Deduplication and grouping analysis"),
  prompts: z.array(PromptTaskSchema),
});
