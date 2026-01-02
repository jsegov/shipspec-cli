import { join } from "path";
import { mkdir, appendFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";

import { createSecretsStore } from "../core/secrets/secrets-store.js";
import {
  writeProjectState,
  readProjectState,
  PROJECT_DIR,
  OUTPUTS_DIR,
  findProjectRoot,
} from "../core/project/project-state.js";
import { logger } from "../utils/logger.js";
import { CliRuntimeError, CliUsageError } from "../cli/errors.js";

export interface ConnectOptions {
  openrouterKey: string;
  tavilyKey?: string;
}

export interface ConnectResult {
  projectRoot: string;
  projectId: string;
  initializedAt: string;
}

export async function connectFlow(options: ConnectOptions): Promise<ConnectResult> {
  const cwd = process.cwd();
  const existingRoot = findProjectRoot(cwd);
  const existingState = existingRoot ? await readProjectState(existingRoot) : null;

  const projectRoot = existingRoot ?? cwd;

  if (!options.openrouterKey) {
    throw new CliUsageError("OpenRouter API key is required.");
  }

  const secretsStore = createSecretsStore(projectRoot);

  try {
    await secretsStore.set("OPENROUTER_API_KEY", options.openrouterKey);
    if (options.tavilyKey) {
      await secretsStore.set("TAVILY_API_KEY", options.tavilyKey);
    }
  } catch (err) {
    throw new CliRuntimeError("Failed to store API keys in OS keychain.", err);
  }

  const shipSpecDir = join(projectRoot, PROJECT_DIR);
  const outputsDir = join(shipSpecDir, OUTPUTS_DIR);

  try {
    if (!existsSync(shipSpecDir)) {
      await mkdir(shipSpecDir, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(outputsDir)) {
      await mkdir(outputsDir, { recursive: true, mode: 0o700 });
    }
  } catch (err) {
    throw new CliRuntimeError("Failed to create .ship-spec directory structure.", err);
  }

  const now = new Date().toISOString();
  const projectId = existingState?.projectId ?? randomUUID();

  await writeProjectState(projectRoot, {
    schemaVersion: 1,
    projectId,
    initializedAt: existingState?.initializedAt ?? now,
    updatedAt: now,
    projectRoot,
  });

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
    }
  } catch {
    logger.warn("Could not update .gitignore. Please add .ship-spec/ manually.");
  }

  return {
    projectRoot,
    projectId,
    initializedAt: existingState?.initializedAt ?? now,
  };
}
