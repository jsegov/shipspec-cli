import { Command } from "commander";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import chalk from "chalk";

import { SUPPORTED_CHAT_MODELS } from "../../config/schema.js";
import { findProjectRoot } from "../../core/project/project-state.js";
import { logger } from "../../utils/logger.js";
import { CliUsageError } from "../errors.js";

const CONFIG_FILE = "shipspec.json";

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
    const projectRoot = findProjectRoot(process.cwd());
    const configPath = projectRoot
      ? join(projectRoot, CONFIG_FILE)
      : join(process.cwd(), CONFIG_FILE);

    if (!existsSync(configPath)) {
      logger.info(`Current model: ${chalk.cyan("google/gemini-3-flash-preview")} (default)`);
      return;
    }

    try {
      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        llm?: { modelName?: string };
      };
      const currentModel = content.llm?.modelName ?? "google/gemini-3-flash-preview";
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
    const configPath = join(projectRoot, CONFIG_FILE);

    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
      } catch {
        // Fallback if file is corrupted
        config = {};
      }
    }

    const llmConfig = (config.llm as Record<string, unknown> | undefined) ?? {};
    config.llm = { ...llmConfig, modelName: fullModelName };
    await writeFile(configPath, JSON.stringify(config, null, 2));

    logger.success(`Model set to: ${chalk.cyan(fullModelName)}`);
  });

export const modelCommand = new Command("model")
  .description("Manage chat model selection")
  .addCommand(listCommand)
  .addCommand(currentCommand)
  .addCommand(setCommand);
