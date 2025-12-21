import { z } from "zod";
import fg from "fast-glob";
import pLimit from "p-limit";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { readFile, writeFile, stat, mkdir } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";

import type { ShipSpecConfig } from "../../config/schema.js";
import type { LanceDBManager } from "../../core/storage/vector-store.js";
import type { DocumentRepository } from "../../core/storage/repository.js";
import { chunkSourceFile } from "../../core/parsing/index.js";
import { readSourceFile, isSourceFile, getRelativePath } from "../../utils/fs.js";
import { logger } from "../../utils/logger.js";
import type { CodeChunk } from "../../core/types/index.js";

const execAsync = promisify(exec);

const IndexManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectRoot: z.string(),
  lastIndexedCommit: z.string().optional(),
  embeddingSignature: z.object({
    provider: z.string(),
    modelName: z.string(),
    dimensions: z.number(),
  }),
  files: z.record(
    z.string(),
    z.object({
      mtimeMs: z.number(),
      size: z.number(),
    })
  ),
  updatedAt: z.string(),
});

type IndexManifest = z.infer<typeof IndexManifestSchema>;

export interface EnsureIndexOptions {
  config: ShipSpecConfig;
  repository: DocumentRepository;
  vectorStore: LanceDBManager;
  manifestPath: string;
  forceReindex?: boolean;
}

export interface IndexResult {
  added: number;
  modified: number;
  removed: number;
}

async function discoverFiles(projectPath: string, ignorePatterns: string[]): Promise<string[]> {
  const files = await fg("**/*", {
    cwd: projectPath,
    ignore: ignorePatterns,
    onlyFiles: true,
    absolute: true,
    dot: false,
  });

  return files.filter(isSourceFile);
}

function generateChunkId(): string {
  return randomUUID();
}

async function processFile(filepath: string, projectPath: string): Promise<CodeChunk[]> {
  const content = await readSourceFile(filepath);
  const relativePath = getRelativePath(filepath, projectPath);

  const chunks = await chunkSourceFile(relativePath, content);

  return chunks.map((chunk) => ({
    ...chunk,
    id: chunk.id || generateChunkId(),
    filepath: relativePath,
  }));
}

async function isGitAvailable(projectPath: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync("git rev-parse --is-inside-work-tree", { cwd: projectPath });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function getGitHead(projectPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git rev-parse HEAD", { cwd: projectPath });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function getGitChanges(
  projectPath: string,
  lastCommit?: string
): Promise<{ added: string[]; modified: string[]; removed: string[] }> {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];

  try {
    if (lastCommit) {
      try {
        const { stdout } = await execAsync(
          `git diff --name-status -z ${lastCommit} HEAD --relative`,
          {
            cwd: projectPath,
          }
        );
        const parts = stdout.split("\0");
        for (let i = 0; i < parts.length - 1; ) {
          const status = parts[i++];
          const file = parts[i++];
          if (!status || !file) continue;

          if (status.startsWith("A")) added.push(file);
          else if (status.startsWith("M")) modified.push(file);
          else if (status.startsWith("D")) removed.push(file);
          else if (status.startsWith("R")) {
            const newFile = parts[i++];
            if (newFile) {
              removed.push(file);
              added.push(newFile);
            }
          }
        }
      } catch (e) {
        logger.debug(`Git diff failed: ${String(e)}`, true);
      }
    }

    const { stdout: statusOut } = await execAsync("git status --porcelain -z", {
      cwd: projectPath,
    });
    const statusParts = statusOut.split("\0");
    for (let i = 0; i < statusParts.length - 1; i++) {
      const line = statusParts[i];
      if (!line) continue;
      const status = line.slice(0, 2).trim();
      const file = line.slice(3);
      if (!file) continue;

      if (status === "??" || status === "A" || status === "AM") {
        if (!added.includes(file)) added.push(file);
      } else if (status === "M" || status === "MM" || status === "T") {
        if (!modified.includes(file)) modified.push(file);
      } else if (status === "D") {
        if (!removed.includes(file)) removed.push(file);
      } else if (status.startsWith("R")) {
        const nextEntry = statusParts[i + 1];
        if (nextEntry && !nextEntry.startsWith(" ")) {
          const newFile = file;
          const oldFile = nextEntry;
          i++;
          if (!removed.includes(oldFile)) removed.push(oldFile);
          if (!added.includes(newFile)) added.push(newFile);
        }
      }
    }
  } catch (error) {
    logger.debug(`Failed to get git changes: ${String(error)}`, true);
  }

  return { added, modified, removed };
}

export async function ensureIndex(options: EnsureIndexOptions): Promise<IndexResult> {
  const { config, repository, vectorStore, manifestPath, forceReindex = false } = options;
  const projectPath = resolve(config.projectPath);

  let manifest: IndexManifest | null = null;
  try {
    const content = await readFile(manifestPath, "utf-8");
    const parsed = IndexManifestSchema.safeParse(JSON.parse(content));
    if (parsed.success) {
      manifest = parsed.data;
    }
  } catch {
    // Manifest missing or invalid
  }

  const currentSignature = {
    provider: config.embedding.provider,
    modelName: config.embedding.modelName,
    dimensions: config.embedding.dimensions,
  };

  const needsFullRebuild =
    forceReindex ||
    !manifest ||
    manifest.embeddingSignature.provider !== currentSignature.provider ||
    manifest.embeddingSignature.modelName !== currentSignature.modelName ||
    manifest.embeddingSignature.dimensions !== currentSignature.dimensions;

  if (needsFullRebuild) {
    logger.progress(forceReindex ? "Force re-indexing..." : "Starting full codebase indexing...");
    await vectorStore.dropTable("code_chunks");

    const files = await discoverFiles(projectPath, config.ignorePatterns);
    const successfulFiles = await runIndexing(projectPath, files, repository);
    const successfulAbsolutePaths = files.filter((f) =>
      successfulFiles.has(getRelativePath(f, projectPath))
    );

    await saveManifest(manifestPath, {
      schemaVersion: 1,
      projectRoot: projectPath,
      lastIndexedCommit: await getGitHead(projectPath),
      embeddingSignature: currentSignature,
      files: await getFileStats(projectPath, successfulAbsolutePaths),
      updatedAt: new Date().toISOString(),
    });

    return { added: successfulFiles.size, modified: 0, removed: 0 };
  }

  if (!manifest) {
    throw new Error("Index manifest not found");
  }

  const gitAvailable = await isGitAvailable(projectPath);
  let changedFiles: { added: string[]; modified: string[]; removed: string[] };

  if (gitAvailable) {
    changedFiles = await getGitChanges(projectPath, manifest.lastIndexedCommit);
  } else {
    const currentFiles = await discoverFiles(projectPath, config.ignorePatterns);
    changedFiles = { added: [], modified: [], removed: [] };

    const manifestFiles = new Set(Object.keys(manifest.files));
    for (const file of currentFiles) {
      const relPath = getRelativePath(file, projectPath);
      const stats = await stat(file);
      const mstat = manifest.files[relPath];

      if (!mstat) {
        changedFiles.added.push(relPath);
      } else if (mstat.mtimeMs !== stats.mtimeMs || mstat.size !== stats.size) {
        changedFiles.modified.push(relPath);
      }
      manifestFiles.delete(relPath);
    }
    changedFiles.removed = Array.from(manifestFiles);
  }

  const toProcess = [...new Set([...changedFiles.added, ...changedFiles.modified])].filter((f) =>
    isSourceFile(f)
  );

  const toRemove = changedFiles.removed.filter(isSourceFile);

  if (toProcess.length === 0 && toRemove.length === 0) {
    return { added: 0, modified: 0, removed: 0 };
  }

  logger.progress(
    `Updating index (${String(toProcess.length)} changed, ${String(toRemove.length)} removed)...`
  );

  for (const relPath of toRemove) {
    await repository.deleteByFilepath(relPath);
  }

  const successfulFiles = await runIndexing(
    projectPath,
    toProcess.map((f) => resolve(projectPath, f)),
    repository
  );

  const removedSet = new Set(toRemove);
  const updatedFiles: Record<string, { mtimeMs: number; size: number }> = {};

  for (const [path, stats] of Object.entries(manifest.files)) {
    if (!removedSet.has(path)) {
      updatedFiles[path] = stats;
    }
  }

  for (const relPath of successfulFiles) {
    try {
      const absPath = resolve(projectPath, relPath);
      const s = await stat(absPath);
      updatedFiles[relPath] = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      // File might have been deleted since processing
    }
  }

  await saveManifest(manifestPath, {
    schemaVersion: 1,
    projectRoot: manifest.projectRoot,
    embeddingSignature: currentSignature,
    lastIndexedCommit: await getGitHead(projectPath),
    files: updatedFiles,
    updatedAt: new Date().toISOString(),
  });

  const addedSourceFiles = changedFiles.added.filter(isSourceFile);
  const modifiedSourceFiles = changedFiles.modified.filter(isSourceFile);

  const actualAdded = addedSourceFiles.filter((f) => successfulFiles.has(f)).length;
  const actualModified = modifiedSourceFiles.filter((f) => successfulFiles.has(f)).length;

  return {
    added: actualAdded,
    modified: actualModified,
    removed: toRemove.length,
  };
}

async function runIndexing(
  projectPath: string,
  files: string[],
  repository: DocumentRepository
): Promise<Set<string>> {
  const concurrency = 10;
  const batchSize = 50;
  const limit = pLimit(concurrency);

  const allChunks: CodeChunk[] = [];
  const successfulFiles = new Set<string>();
  let processedCount = 0;

  const tasks = files.map((file) =>
    limit(async () => {
      try {
        const chunks = await processFile(file, projectPath);
        const relPath = getRelativePath(file, projectPath);

        try {
          await repository.deleteByFilepath(relPath);
        } catch (deleteError) {
          logger.debug(`Failed to delete old chunks for ${relPath}: ${String(deleteError)}`, true);
        }

        allChunks.push(...chunks);
        successfulFiles.add(relPath);
      } catch (error) {
        logger.debug(`Failed to process ${file}: ${String(error)}`, true);
      } finally {
        processedCount++;
        if (processedCount % 10 === 0 || processedCount === files.length) {
          logger.progress(`Indexing [${String(processedCount)}/${String(files.length)}]...`);
        }
      }
    })
  );

  await Promise.all(tasks);

  if (allChunks.length > 0) {
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      await repository.addDocuments(batch);
    }
  }

  return successfulFiles;
}

async function getFileStats(
  projectPath: string,
  files: string[]
): Promise<Record<string, { mtimeMs: number; size: number }>> {
  const stats: Record<string, { mtimeMs: number; size: number }> = {};
  for (const file of files) {
    try {
      const s = await stat(file);
      stats[getRelativePath(file, projectPath)] = {
        mtimeMs: s.mtimeMs,
        size: s.size,
      };
    } catch {
      // File might have been deleted since discovery
    }
  }
  return stats;
}

async function saveManifest(path: string, manifest: IndexManifest): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf-8");
}
