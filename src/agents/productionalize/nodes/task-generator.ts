import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ProductionalizeStateType, TaskmasterTask } from "../state.js";

const TaskSchema: z.ZodType<TaskmasterTask> = z.lazy(() => z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  status: z.literal("pending"),
  priority: z.enum(["high", "medium", "low"]),
  dependencies: z.array(z.number()),
  details: z.string(),
  testStrategy: z.string(),
  subtasks: z.array(TaskSchema).optional(),
}));

const TasksOutputSchema = z.object({
  tasks: z.array(TaskSchema),
});

export function createTaskGeneratorNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(TasksOutputSchema);

  return async (state: ProductionalizeStateType) => {
    const { findings, signals } = state;

    const systemPrompt = `You are a technical task architect. Your goal is to convert production-readiness findings into a structured, agent-executable task list in JSON format.
The tasks must be Taskmaster-compatible.

Guidelines:
1. Deduplicate similar findings.
2. Group related findings into a single parent task if appropriate.
3. Assign a numeric ID to each task starting from 1.
4. Establish dependencies between tasks (e.g., "Add logging middleware" before "Audit PII masking").
5. For each task, provide:
   - Priority (high/medium/low based on finding severity: critical/high -> high, medium -> medium, low/info -> low).
   - Details: Detailed, step-by-step implementation guidance for a coding agent.
   - Test Strategy: Clear instructions on how to verify the implementation.

Ground your tasks in the actual file paths and evidence from the findings.`;

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Findings:
${JSON.stringify(findings, null, 2)}

Generate the agent-executable task list in JSON format.`;

    const output = await structuredModel.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    return {
      tasks: output.tasks,
    };
  };
}
