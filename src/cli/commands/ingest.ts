import { Command, Option } from "commander";
import fg from "fast-glob";
import pLimit from "p-limit";
import cliProgress from "cli-progress";
import { resolve } from "path";
import { randomUUID } from "crypto";

import { loadConfig } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { chunkSourceFile } from "../../core/parsing/index.js";
import { readSourceFile, isSourceFile, getRelativePath } from "../../utils/fs.js";
import { logger } from "../../utils/logger.js";
import type { CodeChunk } from "../../core/types/index.js";

interface IngestOptions {
  concurrency: string;
  batchSize: string;
  dryRun: boolean;
  resolvedConfig?: ShipSpecConfig;
}

async function discoverFiles(
  projectPath: string,
  ignorePatterns: string[]
): Promise<string[]> {
  const files = await fg("**/*", {
    cwd: projectPath,
    ignore: ignorePatterns,
    onlyFiles: true,
    absolute: true,
    dot: false,
  });

  // Filter to only source files we can process
  return files.filter(isSourceFile);
}

function generateChunkId(): string {
  return randomUUID();
}

async function processFile(
  filepath: string,
  projectPath: string
): Promise<CodeChunk[]> {
  const content = await readSourceFile(filepath);
  const relativePath = getRelativePath(filepath, projectPath);

  const chunks = await chunkSourceFile(relativePath, content);

  // Ensure each chunk has a unique ID
  return chunks.map((chunk) => ({
    ...chunk,
    id: chunk.id || generateChunkId(),
    filepath: relativePath,
  }));
}

async function ingestAction(options: IngestOptions): Promise<void> {
  const config = options.resolvedConfig || (await loadConfig(process.cwd()));
  const concurrency = parseInt(options.concurrency, 10);
  const batchSize = parseInt(options.batchSize, 10);

  const projectPath = resolve(config.projectPath);

  logger.info(`Starting ingestion for: ${projectPath}`);
  logger.info(`Concurrency: ${concurrency}, Batch size: ${batchSize}`);

  // Discover files
  logger.progress("Discovering files...");
  const files = await discoverFiles(projectPath, config.ignorePatterns);

  if (files.length === 0) {
    logger.warn("No source files found to index.");
    return;
  }

  logger.info(`Found ${files.length} source files`);

  // Dry run mode - just show what would be processed
  if (options.dryRun) {
    logger.info("Dry run mode - files that would be processed:");
    files.forEach((f) => logger.plain(`  ${getRelativePath(f, projectPath)}`));
    logger.info(`Total: ${files.length} files`);
    return;
  }

  // Initialize storage
  logger.progress("Initializing vector store...");
  const vectorStore = new LanceDBManager(resolve(config.vectorDbPath));
  const embeddings = await createEmbeddingsModel(config.embedding);
  const repository = new DocumentRepository(
    vectorStore,
    embeddings,
    config.embedding.dimensions
  );

  // Setup progress bar
  const progressBar = new cliProgress.SingleBar(
    {
      format:
        "Ingesting |{bar}| {percentage}% || {value}/{total} files || {eta}s remaining",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  // Process files with concurrency limit
  const limit = pLimit(concurrency);
  let processedFiles = 0;
  let totalChunks = 0;
  let errors = 0;
  const allChunks: CodeChunk[] = [];

  progressBar.start(files.length, 0);

  // Process files in parallel with concurrency limit
  const tasks = files.map((file) =>
    limit(async () => {
      try {
        const chunks = await processFile(file, projectPath);
        allChunks.push(...chunks);
        totalChunks += chunks.length;
      } catch (error) {
        errors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug(
          `Failed to process ${getRelativePath(file, projectPath)}: ${errorMsg}`,
          true
        );
      } finally {
        processedFiles++;
        progressBar.update(processedFiles);
      }
    })
  );

  await Promise.all(tasks);
  progressBar.stop();

  if (allChunks.length === 0) {
    logger.warn("No chunks generated from files.");
    return;
  }

  // Add chunks to repository in batches
  logger.progress(`Adding ${allChunks.length} chunks to vector store...`);

  const embeddingProgressBar = new cliProgress.SingleBar(
    {
      format:
        "Embedding |{bar}| {percentage}% || {value}/{total} chunks || {eta}s remaining",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  embeddingProgressBar.start(allChunks.length, 0);

  // Process chunks in batches
  let successfulChunks = 0;
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    try {
      await repository.addDocuments(batch);
      successfulChunks += batch.length;
      embeddingProgressBar.update(successfulChunks);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to add batch ${Math.floor(i / batchSize) + 1}: ${errorMsg}`);
    }
  }

  embeddingProgressBar.stop();

  // Summary
  logger.success(`Ingestion complete!`);
  logger.info(`  Files processed: ${processedFiles - errors}/${files.length}`);
  logger.info(`  Chunks created: ${totalChunks}`);
  if (errors > 0) {
    logger.warn(`  Files with errors: ${errors}`);
  }
  logger.info(`  Vector store: ${config.vectorDbPath}`);
}

export const ingestCommand = new Command("ingest")
  .description("Index the codebase into the vector store")
  .addOption(new Option("--resolved-config").hideHelp())
  .option(
    "--concurrency <n>",
    "Number of concurrent file processors",
    "10"
  )
  .option(
    "--batch-size <n>",
    "Documents per embedding batch",
    "50"
  )
  .option(
    "--dry-run",
    "Show files that would be processed without indexing",
    false
  )
  .action(ingestAction);
