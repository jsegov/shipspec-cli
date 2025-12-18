#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { configCommand } from "./commands/config.js";
import { ingestCommand } from "./commands/ingest.js";
import { specCommand } from "./commands/spec.js";

const program = new Command();

program
  .name("ship-spec")
  .description("Autonomous semantic engine for codebase analysis and spec generation")
  .version("0.1.0")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-c, --config <path>", "Path to config file")
  .hook("preAction", async (thisCommand) => {
    const config = await loadConfig(process.cwd(), {});
    thisCommand.setOptionValue("resolvedConfig", config);
  });

program.addCommand(configCommand);
program.addCommand(ingestCommand);
program.addCommand(specCommand);

program.parse();
