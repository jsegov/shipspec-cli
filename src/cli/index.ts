#!/usr/bin/env node

import { Command } from "commander";
import { config as loadDotenv } from "dotenv";
import { join } from "path";

import { loadConfig } from "../config/loader.js";
import { configCommand } from "./commands/config.js";
import { ingestCommand } from "./commands/ingest.js";
import { specCommand } from "./commands/spec.js";

loadDotenv({ path: join(process.cwd(), ".env") });

const program = new Command();

program
  .name("ship-spec")
  .description(
    "Autonomous semantic engine for codebase analysis and spec generation"
  )
  .version("0.1.0")
  .option("-v, --verbose", "Enable verbose logging")
  .option("-c, --config <path>", "Path to config file")
  .hook("preAction", async (thisCommand, actionCommand) => {
    const config = await loadConfig(process.cwd(), {});
    (actionCommand || thisCommand).setOptionValue("resolvedConfig", config);
  });

program.addCommand(configCommand);
program.addCommand(ingestCommand);
program.addCommand(specCommand);

program.parse();
