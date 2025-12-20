import { Command, Option } from "commander";
import { ShipSpecConfig } from "../../config/schema.js";
import { loadConfig } from "../../config/loader.js";

interface ConfigOptions {
  json: boolean;
  resolvedConfig?: ShipSpecConfig;
}

export const configCommand = new Command("config")
  .description("Display resolved configuration")
  .addOption(new Option("--resolved-config").hideHelp())
  .option("--json", "Output as JSON")
  .action(async (options: ConfigOptions) => {
    const config = options.resolvedConfig ?? (await loadConfig());
    
    if (options.json) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log("Ship Spec Configuration:");
      console.log("========================");
      console.log(`Project Path: ${config.projectPath}`);
      console.log(`Vector DB Path: ${config.vectorDbPath}`);
      console.log();
      console.log("LLM Configuration:");
      console.log(`  Provider: ${config.llm.provider}`);
      console.log(`  Model: ${config.llm.modelName}`);
      console.log(`  Temperature: ${String(config.llm.temperature)}`);
      console.log(`  Max Retries: ${String(config.llm.maxRetries)}`);
      console.log(`  Timeout: ${config.llm.timeout ? `${String(config.llm.timeout)}ms` : 'none'}`);
      console.log(`  Max Context Tokens: ${String(config.llm.maxContextTokens)}`);
      console.log(`  Reserved Output Tokens: ${String(config.llm.reservedOutputTokens)}`);
      console.log();
      console.log("Embedding Configuration:");
      console.log(`  Provider: ${config.embedding.provider}`);
      console.log(`  Model: ${config.embedding.modelName}`);
      console.log(`  Dimensions: ${String(config.embedding.dimensions)}`);
      console.log(`  Max Retries: ${String(config.embedding.maxRetries)}`);
      console.log();
      console.log("Checkpoint Configuration:");
      console.log(`  Enabled: ${String(config.checkpoint.enabled)}`);
      console.log(`  Type: ${config.checkpoint.type}`);
      if (config.checkpoint.sqlitePath) {
        console.log(`  SQLite Path: ${config.checkpoint.sqlitePath}`);
      }
      console.log();
      console.log(`Ignore Patterns: ${config.ignorePatterns.join(", ")}`);
    }
  });
