import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";

export const configCommand = new Command("config")
  .description("Display resolved configuration")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const config = await loadConfig();
    
    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log("Ship Spec Configuration:");
      console.log("========================");
      console.log(`Project Path: ${config.projectPath}`);
      console.log(`Vector DB Path: ${config.vectorDbPath}`);
      console.log(`LLM Provider: ${config.llm.provider}`);
      console.log(`LLM Model: ${config.llm.modelName}`);
      console.log(`Embedding Provider: ${config.embedding.provider}`);
      console.log(`Embedding Model: ${config.embedding.modelName}`);
      console.log(`Ignore Patterns: ${config.ignorePatterns.join(", ")}`);
    }
  });
