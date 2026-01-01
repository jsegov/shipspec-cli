import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import { PROMPT_GENERATOR_TEMPLATE, PromptsOutputSchema } from "../../prompts/index.js";
import { redactObject } from "../../../utils/redaction.js";

/**
 * Creates the prompt generator node.
 * Converts findings and the production readiness report into agent-ready task prompts.
 *
 * The finalReport provides high-level prioritization and context that informs
 * how tasks should be grouped, ordered, and described.
 *
 * @param model - The chat model to use
 * @param shouldRedact - Whether to redact sensitive data (for cloud LLMs)
 */
export function createPromptGeneratorNode(model: BaseChatModel, shouldRedact = false) {
  const structuredModel = model.withStructuredOutput(PromptsOutputSchema);

  return async (state: ProductionalizeStateType) => {
    const { findings, signals, finalReport } = state;

    // Apply redaction inline for serialization to avoid type mismatches.
    // redactObject returns Redacted<T> which may have string values where
    // the original had numbers/booleans/objects at sensitive keys.
    const signalsForPrompt = shouldRedact ? redactObject(signals) : signals;
    const findingsForPrompt = shouldRedact ? redactObject(findings) : findings;
    const reportForPrompt =
      shouldRedact && finalReport ? redactObject({ report: finalReport }).report : finalReport;

    // Build prompt with report context for prioritization
    const userPrompt = `## Production Readiness Report
${reportForPrompt || "(No report available)"}

## Project Signals
${JSON.stringify(signalsForPrompt, null, 2)}

## Detailed Findings
${JSON.stringify(findingsForPrompt, null, 2)}

Generate agent-ready task prompts based on the report's recommendations and priorities.
Use the report's severity assessments and timeline recommendations to order tasks appropriately.`;

    const output = await structuredModel.invoke([
      new SystemMessage(PROMPT_GENERATOR_TEMPLATE),
      new HumanMessage(userPrompt),
    ]);

    const formattedMarkdown = output.prompts
      .map((p) => `### Task ${String(p.id)}:\n\`\`\`\n${p.prompt}\n\`\`\``)
      .join("\n\n");

    return {
      taskPrompts: formattedMarkdown,
    };
  };
}
