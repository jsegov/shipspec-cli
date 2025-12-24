import { Command } from "commander";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import { z } from "zod";

import { SUPPORTED_CHAT_MODELS } from "../../config/schema.js";

// Minimal schema for reading config file - only extracts llm.modelName
const PartialConfigSchema = z.looseObject({
  llm: z
    .looseObject({
      modelName: z.string().optional(),
    })
    .optional(),
});
import { CONFIG_FILES } from "../../config/loader.js";
import { findProjectRoot } from "../../core/project/project-state.js";
import { logger } from "../../utils/logger.js";
import { CliUsageError } from "../errors.js";

/**
 * Finds the first existing config file in the given directory.
 * Returns the path if found, or null if no config file exists.
 */
function findExistingConfigFile(directory: string): string | null {
  for (const filename of CONFIG_FILES) {
    const filepath = join(directory, filename);
    if (existsSync(filepath)) {
      return filepath;
    }
  }
  return null;
}

/**
 * Gets the config file path to use for reading/writing.
 * Returns the existing config file if found, otherwise defaults to shipspec.json.
 */
function getConfigPath(directory: string): string {
  return findExistingConfigFile(directory) ?? join(directory, CONFIG_FILES[0]);
}

// Subcommand: list
const listCommand = new Command("list").description("List available models").action(() => {
  logger.info("Available models:");
  for (const [alias, fullName] of Object.entries(SUPPORTED_CHAT_MODELS)) {
    logger.plain(`  ${chalk.cyan(alias)} -> ${fullName}`);
  }
});

// Subcommand: current
const currentCommand = new Command("current")
  .description("Show currently configured model")
  .action(async () => {
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const existingConfig = findExistingConfigFile(projectRoot);

    if (!existingConfig) {
      logger.info(`Current model: ${chalk.cyan("google/gemini-3-flash-preview")} (default)`);
      return;
    }

    try {
      const raw: unknown = JSON.parse(await readFile(existingConfig, "utf-8"));
      const parsed = PartialConfigSchema.safeParse(raw);
      const currentModel = parsed.success
        ? (parsed.data.llm?.modelName ?? "google/gemini-3-flash-preview")
        : "google/gemini-3-flash-preview";
      logger.info(`Current model: ${chalk.cyan(currentModel)}`);
    } catch {
      logger.info(`Current model: ${chalk.cyan("google/gemini-3-flash-preview")} (default)`);
    }
  });

// Subcommand: set
const setCommand = new Command("set")
  .description("Set the chat model")
  .argument("<model>", "Model alias or full name (gemini-flash, claude-sonnet, gpt-pro)")
  .action(async (model: string) => {
    // Resolve alias to full model name
    const fullModelName = (SUPPORTED_CHAT_MODELS as Record<string, string>)[model] ?? model;

    // Validate model is supported
    const validModels = Object.values(SUPPORTED_CHAT_MODELS) as string[];
    if (!validModels.includes(fullModelName)) {
      throw new CliUsageError(
        `Invalid model: "${model}". Supported models: ${Object.keys(SUPPORTED_CHAT_MODELS).join(", ")}`
      );
    }

    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const configPath = getConfigPath(projectRoot);

    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        const raw: unknown = JSON.parse(await readFile(configPath, "utf-8"));
        // Validate structure with Zod - .loose() preserves unknown properties for write-back
        const parsed = PartialConfigSchema.safeParse(raw);
        if (!parsed.success) {
          throw new CliUsageError(
            `Invalid config file at ${configPath}: ${parsed.error.issues.map((i) => i.message).join(", ")}`
          );
        }
        config = raw as Record<string, unknown>;
      } catch (err) {
        if (err instanceof CliUsageError) throw err;
        throw new CliUsageError(`Failed to read config file at ${configPath}: invalid JSON`);
      }
    }

    const llmConfig = (config.llm as Record<string, unknown> | undefined) ?? {};
    // All SUPPORTED_CHAT_MODELS are OpenRouter slugs, so ensure provider is set correctly
    config.llm = { ...llmConfig, provider: "openrouter", modelName: fullModelName };
    await writeFile(configPath, JSON.stringify(config, null, 2));

    logger.success(`Model set to: ${chalk.cyan(fullModelName)} (provider: openrouter)`);
  });

export const modelCommand = new Command("model")
  .description("Manage chat model selection")
  .addCommand(listCommand)
  .addCommand(currentCommand)
  .addCommand(setCommand);
