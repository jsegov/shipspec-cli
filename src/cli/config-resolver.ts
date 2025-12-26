import { isAbsolute, resolve } from "path";

import { loadConfig } from "../config/loader.js";
import type { ShipSpecConfig } from "../config/schema.js";
import { findProjectRoot } from "../core/project/project-state.js";

const ROOT_AWARE_COMMANDS = new Set(["productionalize", "config", "planning"]);

interface ResolveCliConfigParams {
  actionName: string;
  strictConfig?: boolean;
  configPath?: string;
  cwd?: string;
}

export async function resolveCliConfig(params: ResolveCliConfigParams): Promise<ShipSpecConfig> {
  const cwd = params.cwd ?? process.cwd();
  const shouldSearchRoot = ROOT_AWARE_COMMANDS.has(params.actionName);
  const projectRoot = shouldSearchRoot ? findProjectRoot(cwd) : null;
  const configCwd = projectRoot ?? cwd;

  let resolvedConfigPath = params.configPath;
  if (resolvedConfigPath && !isAbsolute(resolvedConfigPath)) {
    resolvedConfigPath = resolve(cwd, resolvedConfigPath);
  }

  const { config } = await loadConfig(
    configCwd,
    {},
    {
      strict: !!params.strictConfig,
      configPath: resolvedConfigPath,
    }
  );
  return config;
}
