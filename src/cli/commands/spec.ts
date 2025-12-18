import { Command } from "commander";

export const specCommand = new Command("spec")
  .description("Generate a specification based on a prompt")
  .argument("<prompt>", "The prompt to generate a spec for")
  .action((prompt) => {
    console.log(`Spec command for: "${prompt}" - to be implemented in Phase 5`);
  });
