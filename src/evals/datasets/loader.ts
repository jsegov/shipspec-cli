/**
 * Dataset loading utilities for evaluation framework.
 * Supports loading from local JSON files or LangSmith datasets.
 */
import { Client } from "langsmith";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { z } from "zod";

import {
  DatasetSchema,
  ProductionalizeExampleSchema,
  PlanningExampleSchema,
  AskExampleSchema,
  type ProductionalizeExample,
  type PlanningExample,
  type AskExample,
} from "./schemas.js";
import type { EvalWorkflow } from "../types.js";
import { logger } from "../../utils/logger.js";

/**
 * Options for loading a dataset.
 */
export interface LoadDatasetOptions {
  /** LangSmith client (optional, created if needed for remote datasets) */
  client?: Client;
  /** API key for LangSmith (uses env var if not provided) */
  apiKey?: string;
  /** When true, only load from local files - never fall back to LangSmith */
  localOnly?: boolean;
}

/**
 * Load a dataset by name, checking local files first, then LangSmith.
 * @param datasetName - Name or path of the dataset
 * @param workflow - The workflow type to validate examples against
 * @param options - Loading options
 * @returns Array of validated examples
 */
export async function loadDataset<T>(
  datasetName: string,
  workflow: EvalWorkflow,
  options: LoadDatasetOptions = {}
): Promise<T[]> {
  // Check if it's a local file path that exists
  if (existsSync(datasetName)) {
    return loadLocalDataset(datasetName, workflow);
  }

  // If it looks like a JSON file path but doesn't exist, provide a clear error
  if (datasetName.endsWith(".json")) {
    throw new Error(
      `Dataset file not found: '${datasetName}'. ` +
        `Please ensure the file exists at the specified path.`
    );
  }

  // In local-only mode, fail with a clear error instead of falling back to LangSmith
  if (options.localOnly) {
    throw new Error(
      `Local dataset not found: '${datasetName}'. ` +
        `In --local-only mode, the dataset must be a path to an existing JSON file ` +
        `(e.g., 'datasets/${datasetName}.json').`
    );
  }

  // Try to load from LangSmith
  return loadLangSmithDataset(datasetName, workflow, options);
}

/**
 * Load a dataset from a local JSON file.
 */
async function loadLocalDataset<T>(filePath: string, workflow: EvalWorkflow): Promise<T[]> {
  const content = await readFile(filePath, "utf-8");
  const data: unknown = JSON.parse(content);

  const dataset = DatasetSchema.parse(data);

  if (dataset.workflow !== workflow) {
    throw new Error(`Dataset workflow mismatch: expected '${workflow}', got '${dataset.workflow}'`);
  }

  const schema = getExampleSchema(workflow);
  return dataset.examples.map((example) => schema.parse(example) as T);
}

/**
 * Load a dataset from LangSmith.
 */
async function loadLangSmithDataset<T>(
  datasetName: string,
  workflow: EvalWorkflow,
  options: LoadDatasetOptions
): Promise<T[]> {
  const client = options.client ?? new Client({ apiKey: options.apiKey });

  const examples: T[] = [];
  const schema = getExampleSchema(workflow);

  for await (const example of client.listExamples({ datasetName })) {
    const parsed = schema.safeParse({
      inputs: example.inputs,
      outputs: example.outputs,
      metadata: example.metadata,
    });

    if (parsed.success) {
      examples.push(parsed.data as T);
    } else {
      // Log warning but continue - some examples may have different schema
      logger.warn(`Skipping invalid example ${example.id}: ${parsed.error.message}`);
    }
  }

  return examples;
}

/**
 * Get the Zod schema for a workflow's examples.
 */
function getExampleSchema(workflow: EvalWorkflow): z.ZodType {
  switch (workflow) {
    case "productionalize":
      return ProductionalizeExampleSchema;
    case "planning":
      return PlanningExampleSchema;
    case "ask":
      return AskExampleSchema;
  }
}

/**
 * Create a dataset in LangSmith from local examples.
 */
export async function createDataset(
  name: string,
  description: string,
  examples: {
    inputs: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }[],
  options: LoadDatasetOptions = {}
): Promise<void> {
  const client = options.client ?? new Client({ apiKey: options.apiKey });

  // Create the dataset
  const dataset = await client.createDataset(name, { description });

  // Add examples using the new API format
  for (const example of examples) {
    await client.createExample({
      inputs: example.inputs,
      outputs: example.outputs ?? {},
      dataset_id: dataset.id,
      metadata: example.metadata,
    });
  }
}

/**
 * Type guards for narrowing example types.
 */
export function isProductionalizeExample(example: unknown): example is ProductionalizeExample {
  return ProductionalizeExampleSchema.safeParse(example).success;
}

export function isPlanningExample(example: unknown): example is PlanningExample {
  return PlanningExampleSchema.safeParse(example).success;
}

export function isAskExample(example: unknown): example is AskExample {
  return AskExampleSchema.safeParse(example).success;
}
