#!/usr/bin/env node

import { Command } from "commander";
import { setMaxListeners } from "events";

import { loadConfig } from "../config/loader.js";
import { configCommand } from "./commands/config.js";
import { productionalizeCommand } from "./commands/productionalize.js";

import { logger } from "../utils/logger.js";
import { CliError } from "./errors.js";

setMaxListeners(100);

const program = new Command();

program
  .name("ship-spec")
  .description("Autonomous semantic engine for codebase analysis and spec generation")
  .version("0.1.0")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-c, --config <path>", "Path to config file")
  .option("--strict-config", "Fail on malformed or invalid config files")
  .hook("preAction", async (thisCommand, actionCommand) => {
    const options = thisCommand.opts();
    const config = await loadConfig(process.cwd(), {}, { strict: !!options.strictConfig });
    actionCommand.setOptionValue("resolvedConfig", config);
  });

program.addCommand(configCommand);
program.addCommand(productionalizeCommand);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const isVerbose = process.argv.includes("-v") || process.argv.includes("--verbose");
    logger.error(error instanceof CliError ? error : "An unexpected error occurred.");
    if (isVerbose && !(error instanceof CliError)) {
      logger.error(error as Error, true);
    }
    process.exitCode = 1;
  }
}

void main();
