/**
 * Zod schemas for evaluation dataset examples.
 * These define the expected structure of inputs and reference outputs for each workflow.
 */
import { z } from "zod";

// ============================================================================
// Productionalize Dataset Schema
// ============================================================================

export const ProductionalizeInputSchema = z.object({
  userQuery: z.string(),
  projectPath: z.string().optional(),
  interactiveMode: z.literal(false).default(false),
});

export const ExpectedFindingSchema = z.object({
  category: z.string(),
  severityMin: z.enum(["critical", "high", "medium", "low", "info"]),
  titlePattern: z.string().optional(),
});

export const ProductionalizeOutputSchema = z.object({
  expectedCategories: z.array(z.string()).optional(),
  minFindingCount: z.number().int().min(0).optional(),
  mustIncludeFindings: z.array(ExpectedFindingSchema).optional(),
  reportMustContain: z.array(z.string()).optional(),
  taskPromptsMustContain: z.array(z.string()).optional(),
});

export const ProductionalizeExampleSchema = z.object({
  inputs: ProductionalizeInputSchema,
  outputs: ProductionalizeOutputSchema,
  metadata: z
    .object({
      description: z.string(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

export type ProductionalizeInput = z.infer<typeof ProductionalizeInputSchema>;
export type ProductionalizeOutput = z.infer<typeof ProductionalizeOutputSchema>;
export type ProductionalizeExample = z.infer<typeof ProductionalizeExampleSchema>;

// ============================================================================
// Planning Dataset Schema
// ============================================================================

export const PlanningInputSchema = z.object({
  initialIdea: z.string(),
  projectPath: z.string().optional(),
  clarificationAnswers: z.array(z.string()).optional(),
  prdFeedback: z.string().optional(),
  specFeedback: z.string().optional(),
});

export const PlanningOutputSchema = z.object({
  prdMustContain: z.array(z.string()).optional(),
  techSpecMustContain: z.array(z.string()).optional(),
  taskPromptCount: z.number().int().min(1).optional(),
  expectedPhases: z.array(z.string()).optional(),
});

export const PlanningExampleSchema = z.object({
  inputs: PlanningInputSchema,
  outputs: PlanningOutputSchema,
  metadata: z
    .object({
      description: z.string(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

export type PlanningInput = z.infer<typeof PlanningInputSchema>;
export type PlanningOutput = z.infer<typeof PlanningOutputSchema>;
export type PlanningExample = z.infer<typeof PlanningExampleSchema>;

// ============================================================================
// Ask Dataset Schema
// ============================================================================

export const ConversationEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const AskInputSchema = z.object({
  question: z.string(),
  projectPath: z.string().optional(),
  history: z.array(ConversationEntrySchema).optional(),
});

export const AskOutputSchema = z.object({
  expectedTopics: z.array(z.string()).optional(),
  mustCiteFiles: z.array(z.string()).optional(),
  mustNotContain: z.array(z.string()).optional(),
  answerContains: z.array(z.string()).optional(),
});

export const AskExampleSchema = z.object({
  inputs: AskInputSchema,
  outputs: AskOutputSchema,
  metadata: z
    .object({
      description: z.string(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
});

export type AskInput = z.infer<typeof AskInputSchema>;
export type AskOutput = z.infer<typeof AskOutputSchema>;
export type AskExample = z.infer<typeof AskExampleSchema>;

// ============================================================================
// Dataset Container Schema
// ============================================================================

export const DatasetSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  workflow: z.enum(["productionalize", "planning", "ask"]),
  examples: z.array(z.unknown()),
});

export type Dataset = z.infer<typeof DatasetSchema>;
