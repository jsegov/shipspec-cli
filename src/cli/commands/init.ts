import { Command } from "commander";
import { join } from "path";
import { mkdir, appendFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import chalk from "chalk";
import { password, confirm } from "@inquirer/prompts";

import { createSecretsStore } from "../../core/secrets/secrets-store.js";
import {
  writeProjectState,
  readProjectState,
  PROJECT_DIR,
  OUTPUTS_DIR,
  findProjectRoot,
} from "../../core/project/project-state.js";
import { logger } from "../../utils/logger.js";
import { CliUsageError, CliRuntimeError } from "../errors.js";

async function initAction(options: { nonInteractive?: boolean }): Promise<void> {
  const cwd = process.cwd();

  logger.info(chalk.bold("\n🚀 Initializing Ship Spec..."));

  // 1. Check if already initialized (searches up the directory tree)
  const existingRoot = findProjectRoot(cwd);
  const existingState = existingRoot ? await readProjectState(existingRoot) : null;

  // Determine the target project root
  let projectRoot: string;

  if (existingRoot) {
    if (options.nonInteractive) {
      // Non-interactive mode: use existing project root (idempotent for CI/CD)
      projectRoot = existingRoot;
      logger.info(
        `Project already initialized at ${chalk.cyan(existingRoot)}. Updating API keys only.`
      );
    } else {
      const isSubdirectory = existingRoot !== cwd;
      const message = isSubdirectory
        ? `A Ship Spec project already exists at ${chalk.cyan(existingRoot)}. Re-initialize there?`
        : "This directory is already initialized. Do you want to re-initialize?";

      const proceed = await confirm({ message, default: false });
      if (!proceed) {
        logger.info("Initialization aborted.");
        return;
      }
      projectRoot = existingRoot;
    }
  } else {
    // Fresh initialization in current directory
    projectRoot = cwd;
  }

  const secretsStore = createSecretsStore(projectRoot);

  let openrouterKey: string | undefined;
  let tavilyKey: string | undefined;

  if (options.nonInteractive) {
    // Non-interactive mode: read from environment
    openrouterKey = process.env.OPENROUTER_API_KEY;
    tavilyKey = process.env.TAVILY_API_KEY;

    if (!openrouterKey) {
      throw new CliUsageError(
        "OPENROUTER_API_KEY environment variable is required in non-interactive mode."
      );
    }
  } else {
    // Interactive mode: check existing keys first
    const existingOpenrouter = await secretsStore.get("OPENROUTER_API_KEY");
    const existingTavily = await secretsStore.get("TAVILY_API_KEY");

    if (existingOpenrouter) {
      const reuse = await confirm({
        message: "Found existing OpenRouter API key in keychain. Use it?",
        default: true,
      });
      if (reuse) {
        openrouterKey = existingOpenrouter;
      }
    }

    openrouterKey ??= await password({
      message: "Enter your OpenRouter API key:",
      validate: (val) => (val.length > 0 ? true : "API key cannot be empty"),
    });

    if (existingTavily) {
      const reuse = await confirm({
        message: "Found existing Tavily API key in keychain. Use it?",
        default: true,
      });
      if (reuse) {
        tavilyKey = existingTavily;
      }
    }

    if (!tavilyKey) {
      const tavilyInput = await password({
        message: "Enter your Tavily API key (optional, press Enter to skip):",
      });
      // Convert empty string to undefined for clarity (empty = skipped)
      tavilyKey = tavilyInput || undefined;
    }
  }

  // 2. Store keys in keychain
  try {
    if (openrouterKey) {
      await secretsStore.set("OPENROUTER_API_KEY", openrouterKey);
    }
    if (tavilyKey) {
      await secretsStore.set("TAVILY_API_KEY", tavilyKey);
    }
  } catch (err) {
    throw new CliRuntimeError("Failed to store API keys in OS keychain.", err);
  }

  // 3. Create directory structure
  const shipSpecDir = join(projectRoot, PROJECT_DIR);
  const outputsDir = join(shipSpecDir, OUTPUTS_DIR);

  try {
    if (!existsSync(shipSpecDir)) {
      await mkdir(shipSpecDir, { recursive: true });
    }
    if (!existsSync(outputsDir)) {
      await mkdir(outputsDir, { recursive: true });
    }
  } catch (err) {
    throw new CliRuntimeError("Failed to create .ship-spec directory structure.", err);
  }

  // 4. Write project.json (preserve existing projectId if re-initializing)
  const now = new Date().toISOString();
  await writeProjectState(projectRoot, {
    schemaVersion: 1,
    projectId: existingState?.projectId ?? randomUUID(),
    initializedAt: existingState?.initializedAt ?? now,
    updatedAt: now,
    projectRoot,
  });

  // 5. Update .gitignore
  const gitignorePath = join(projectRoot, ".gitignore");
  try {
    let hasIgnore = false;
    if (existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, "utf-8");
      if (content.includes(PROJECT_DIR)) {
        hasIgnore = true;
      }
    }

    if (!hasIgnore) {
      await appendFile(gitignorePath, `\n# Ship Spec\n${PROJECT_DIR}/\n`, "utf-8");
      logger.info(chalk.dim("Updated .gitignore with .ship-spec/"));
    }
  } catch {
    logger.warn("Could not update .gitignore. Please add .ship-spec/ manually.");
  }

  logger.success(chalk.green.bold("\n✅ Initialization complete!"));
  logger.info(`Project state: ${chalk.cyan(join(PROJECT_DIR, "project.json"))}`);
  logger.info(`Outputs directory: ${chalk.cyan(join(PROJECT_DIR, OUTPUTS_DIR))}\n`);
}

export const initCommand = new Command("init")
  .description("Initialize Ship Spec in the current directory and configure API keys")
  .option("--non-interactive", "Run in non-interactive mode (requires env vars)")
  .action(initAction);
