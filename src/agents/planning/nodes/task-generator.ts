/**
 * Task Generator Node
 * Generates agent-ready task prompts from the technical specification.
 * Reuses the PromptsOutputSchema format from productionalize.
 */

import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { PlanningStateType } from "../state.js";
import { PromptsOutputSchema } from "../../prompts/schemas.js";
import { PLANNING_TASK_TEMPLATE, buildTaskPrompt } from "../../prompts/planning-templates.js";
import { logger } from "../../../utils/logger.js";

/**
 * Type for the structured output from the task generator.
 */
interface PromptsOutput {
  reasoning: string;
  prompts: { id: number; prompt: string }[];
}

/**
 * Creates the task generator node.
 * Generates implementation task prompts from the approved tech spec.
 *
 * @param model - The chat model to use for task generation
 */
export function createTaskGeneratorNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(PromptsOutputSchema);

  return async (state: PlanningStateType): Promise<Partial<PlanningStateType>> => {
    logger.progress("Generating implementation task prompts...");

    // Build the prompt with tech spec and signals
    const prompt = buildTaskPrompt(state.techSpec, state.signals);

    // Generate structured task prompts
    const output = (await structuredModel.invoke([
      new SystemMessage(PLANNING_TASK_TEMPLATE),
      new HumanMessage(prompt),
    ])) as PromptsOutput;

    logger.info(`Task generation reasoning: ${output.reasoning}`);

    // Format task prompts in the same style as productionalize
    const taskPrompts = output.prompts
      .map((p) => `### Task ${String(p.id)}:\n\`\`\`\n${p.prompt}\n\`\`\``)
      .join("\n\n");

    logger.success(`Generated ${String(output.prompts.length)} implementation tasks.`);

    return {
      taskPrompts,
      phase: "complete" as const,
    };
  };
}
