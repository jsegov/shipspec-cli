import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import { TASK_GENERATOR_TEMPLATE, TasksOutputSchema } from "../../prompts/index.js";

export function createTaskGeneratorNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(TasksOutputSchema);

  return async (state: ProductionalizeStateType) => {
    const { findings, signals } = state;

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}

Findings:
${JSON.stringify(findings, null, 2)}

Generate the agent-executable task list in JSON format.`;

    const output = await structuredModel.invoke([
      new SystemMessage(TASK_GENERATOR_TEMPLATE),
      new HumanMessage(userPrompt),
    ]);

    return {
      tasks: output.tasks,
    };
  };
}
