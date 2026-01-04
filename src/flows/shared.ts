import { join } from "path";

import type { ShipSpecConfig } from "../config/schema.js";
import { CliUsageError } from "../cli/errors.js";
import { findProjectRoot, PROJECT_DIR } from "../core/project/project-state.js";

export function resolveProjectRoot(cwd: string = process.cwd()): string {
  const envRoot = process.env.SHIPSPEC_PROJECT_ROOT?.trim();
  if (envRoot) {
    return envRoot;
  }

  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    throw new CliUsageError("This directory has not been initialized. Run `ship-spec init` first.");
  }

  return projectRoot;
}

export function applyProjectPaths(config: ShipSpecConfig, projectRoot: string): ShipSpecConfig {
  return {
    ...config,
    projectPath: projectRoot,
    vectorDbPath: join(projectRoot, PROJECT_DIR, "lancedb"),
  };
}
