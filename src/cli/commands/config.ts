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
    const config = options.resolvedConfig ?? (await loadConfig());

    if (options.json) {
      logger.output(JSON.stringify(config, null, 2));
    } else {
      logger.plain("Ship Spec Configuration:");
      logger.plain("========================");
      logger.plain(`Project Path: ${config.projectPath}`);
      logger.plain(`Vector DB Path: ${config.vectorDbPath}`);
      logger.plain("");
      logger.plain("LLM Configuration:");
      logger.plain(`  Provider: ${config.llm.provider}`);
      logger.plain(`  Model: ${config.llm.modelName}`);
      logger.plain(`  Temperature: ${String(config.llm.temperature)}`);
      logger.plain(`  Max Retries: ${String(config.llm.maxRetries)}`);
      logger.plain(`  Timeout: ${config.llm.timeout ? `${String(config.llm.timeout)}ms` : "none"}`);
      logger.plain(`  Max Context Tokens: ${String(config.llm.maxContextTokens)}`);
      logger.plain(`  Reserved Output Tokens: ${String(config.llm.reservedOutputTokens)}`);
      logger.plain("");
      logger.plain("Embedding Configuration:");
      logger.plain(`  Provider: ${config.embedding.provider}`);
      logger.plain(`  Model: ${config.embedding.modelName}`);
      logger.plain(`  Dimensions: ${String(config.embedding.dimensions)}`);
      logger.plain(`  Max Retries: ${String(config.embedding.maxRetries)}`);
      logger.plain("");
      logger.plain("Checkpoint Configuration:");
      logger.plain(`  Enabled: ${String(config.checkpoint.enabled)}`);
      logger.plain(`  Type: ${config.checkpoint.type}`);
      if (config.checkpoint.sqlitePath) {
        logger.plain(`  SQLite Path: ${config.checkpoint.sqlitePath}`);
      }
      logger.plain("");
      logger.plain(`Ignore Patterns: ${config.ignorePatterns.join(", ")}`);
    }
  });
