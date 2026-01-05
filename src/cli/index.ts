#!/usr/bin/env node

import { Command } from "commander";
import { setMaxListeners } from "events";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { askCommand } from "./commands/ask.js";
import { configCommand } from "./commands/config.js";
import { evalCommand } from "./commands/eval.js";
import { initCommand } from "./commands/init.js";
import { modelCommand } from "./commands/model.js";
import { planningCommand } from "./commands/planning.js";
import { productionalizeCommand } from "./commands/productionalize.js";
import { resolveCliConfig } from "./config-resolver.js";

import { logger } from "../utils/logger.js";
import { CliError, CliRuntimeError } from "./errors.js";

setMaxListeners(100);

const program = new Command();

program
  .name("ship-spec")
  .description("Autonomous semantic engine for codebase analysis and spec generation")
  .version("0.2.0")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-c, --config <path>", "Path to config file")
  .option("--strict-config", "Fail on malformed or invalid config files")
  .hook("preAction", async (thisCommand, actionCommand) => {
    const { strictConfig, config: configPath } = thisCommand.opts<{
      strictConfig?: boolean;
      config?: string;
    }>();
    const resolvedConfig = await resolveCliConfig({
      actionName: actionCommand.name(),
      strictConfig,
      configPath,
    });
    actionCommand.setOptionValue("resolvedConfig", resolvedConfig);
  });

program.addCommand(askCommand);
program.addCommand(configCommand);
program.addCommand(evalCommand);
program.addCommand(initCommand);
program.addCommand(modelCommand);
program.addCommand(planningCommand);
program.addCommand(productionalizeCommand);

function launchTui(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const tuiRoot = resolve(__dirname, "../../tui");
  const distEntry = resolve(tuiRoot, "dist/index.js");
  const srcEntry = resolve(tuiRoot, "src/index.tsx");
  const tuiEntry = existsSync(distEntry) ? distEntry : srcEntry;

  const proc = spawn("bun", ["run", tuiEntry], {
    cwd: tuiRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      SHIPSPEC_PROJECT_ROOT: process.env.SHIPSPEC_PROJECT_ROOT ?? process.cwd(),
    },
  });

  proc.on("error", (err) => {
    logger.error(err);
    process.exit(1);
  });

  proc.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const hasHeadlessFlag = args.includes("--headless");
    const wantsHelp =
      args.includes("--help") ||
      args.includes("-h") ||
      args.includes("--version") ||
      args.includes("-V");
    const isHeadless = hasHeadlessFlag || !process.stdout.isTTY || wantsHelp;

    if (isHeadless) {
      const filteredArgs = process.argv.filter((arg) => arg !== "--headless");
      await program.parseAsync(filteredArgs);
    } else {
      launchTui();
    }
  } catch (error: unknown) {
    if (error instanceof CliRuntimeError) {
      logger.error(error.toPublicString());
    } else if (error instanceof CliError) {
      logger.error(error);
    } else if (error instanceof Error) {
      logger.error(error);
    } else {
      logger.error(`Unexpected error: ${String(error)}`);
    }
    process.exitCode = 1;
  }
}

void main();
