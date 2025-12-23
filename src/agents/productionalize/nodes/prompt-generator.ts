import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import { PROMPT_GENERATOR_TEMPLATE, PromptsOutputSchema } from "../../prompts/index.js";
import { redactObject } from "../../../utils/redaction.js";

export function createPromptGeneratorNode(model: BaseChatModel, shouldRedact = false) {
  const structuredModel = model.withStructuredOutput(PromptsOutputSchema);

  return async (state: ProductionalizeStateType) => {
    let { findings, signals } = state;

    if (shouldRedact) {
      findings = redactObject(findings);
      signals = redactObject(signals);
    }

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Findings:
${JSON.stringify(findings, null, 2)}

Generate the agent-ready system prompts in the required structured format.`;

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
