import { Command, Option } from "commander";
import { ShipSpecConfig } from "../../config/schema.js";
import { loadConfig } from "../../config/loader.js";
import { logger } from "../../utils/logger.js";

interface ConfigOptions {
  json: boolean;
  resolvedConfig?: ShipSpecConfig;
}

export const configCommand = new Command("config")
  .description("Display resolved configuration")
  .addOption(new Option("--resolved-config").hideHelp())
  .option("--json", "Output as JSON")
  .action(async (options: ConfigOptions) => {
    const config = options.resolvedConfig || (await loadConfig());
    
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
