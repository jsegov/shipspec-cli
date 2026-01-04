import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";

import { SUPPORTED_CHAT_MODELS } from "../config/schema.js";
import { CONFIG_FILES } from "../config/loader.js";
import { findProjectRoot } from "../core/project/project-state.js";
import { CliUsageError } from "../cli/errors.js";

const PartialConfigSchema = z.looseObject({
  llm: z
    .looseObject({
      modelName: z.string().optional(),
    })
    .optional(),
});

function findExistingConfigFile(directory: string): string | null {
  for (const filename of CONFIG_FILES) {
    const filepath = join(directory, filename);
    if (existsSync(filepath)) {
      return filepath;
    }
  }
  return null;
}

function getConfigPath(directory: string): string {
  return findExistingConfigFile(directory) ?? join(directory, CONFIG_FILES[0]);
}

export function listModels(): { alias: string; name: string }[] {
  return Object.entries(SUPPORTED_CHAT_MODELS).map(([alias, name]) => ({ alias, name }));
}

export async function currentModel(): Promise<string> {
  const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
  const existingConfig = findExistingConfigFile(projectRoot);

  if (!existingConfig) {
    return "google/gemini-3-flash-preview";
  }

  try {
    const raw: unknown = JSON.parse(await readFile(existingConfig, "utf-8"));
    const parsed = PartialConfigSchema.safeParse(raw);
    return parsed.success
      ? (parsed.data.llm?.modelName ?? "google/gemini-3-flash-preview")
      : "google/gemini-3-flash-preview";
  } catch {
    return "google/gemini-3-flash-preview";
  }
}

export async function setModel(model: string): Promise<string> {
  const fullModelName = (SUPPORTED_CHAT_MODELS as Record<string, string>)[model] ?? model;

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
      const parsed = PartialConfigSchema.safeParse(raw);
      if (!parsed.success || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new CliUsageError(
          `Invalid config file at ${configPath}: ${parsed.success ? "must be a JSON object" : parsed.error.issues.map((i) => i.message).join(", ")}`
        );
      }
      config = raw as Record<string, unknown>;
    } catch (err) {
      if (err instanceof CliUsageError) throw err;
      throw new CliUsageError(`Failed to read config file at ${configPath}: invalid JSON`);
    }
  }

  const llmConfig = (config.llm as Record<string, unknown> | undefined) ?? {};
  config.llm = { ...llmConfig, provider: "openrouter", modelName: fullModelName };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  return fullModelName;
}
