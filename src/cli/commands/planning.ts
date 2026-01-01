/**
 * Planning Command
 * Guides users through spec-driven development, producing PRD, Tech Spec, and Task List.
 * Uses LangGraph interrupts for human-in-the-loop review cycles.
 */

import { Command } from "commander";
import { mkdir, readFile } from "fs/promises";
import { resolve, join, basename, sep } from "path";
import { existsSync } from "fs";
import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { Command as LangGraphCommand } from "@langchain/langgraph";

import { loadConfig, type ShipSpecSecrets } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { ensureIndex } from "../../core/indexing/ensure-index.js";
import { createPlanningGraph } from "../../agents/planning/graph.js";
import type { PlanningStateType } from "../../agents/planning/state.js";
import {
  PlanningOptionsSchema,
  type TrackMetadata,
  type PlanningOptions,
  type InterruptPayload,
  type ClarificationInterruptPayload,
  type DocumentReviewInterruptPayload,
} from "../../agents/planning/types.js";
import { createCheckpointer } from "../../core/checkpoint/index.js";
import { logger, sanitizeError } from "../../utils/logger.js";
import { CliUsageError, CliRuntimeError } from "../errors.js";
import { findProjectRoot, PROJECT_DIR } from "../../core/project/project-state.js";
import { createSecretsStore } from "../../core/secrets/secrets-store.js";
import { redactText } from "../../utils/redaction.js";
import { writeFileAtomicNoFollow } from "../../utils/safe-write.js";
import { z } from "zod";

/**
 * Maximum length for track IDs (UUIDs are 36 chars, allow some margin).
 */
const MAX_TRACK_ID_LENGTH = 128;

/**
 * Pattern for valid track IDs: alphanumeric, hyphens, and underscores only.
 * This prevents path traversal attacks via `..`, `/`, `\`, etc.
 */
const SAFE_TRACK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates a track ID to prevent path traversal attacks.
 * Track IDs must:
 * - Contain only alphanumeric characters, hyphens, and underscores
 * - Not exceed the maximum length
 * - Not be empty
 *
 * @param trackId - The track ID to validate
 * @throws CliUsageError if the track ID is invalid
 */
export function validateTrackId(trackId: string): void {
  if (!trackId || trackId.length === 0) {
    throw new CliUsageError("Track ID cannot be empty.");
  }

  if (trackId.length > MAX_TRACK_ID_LENGTH) {
    throw new CliUsageError(
      `Track ID exceeds maximum length of ${String(MAX_TRACK_ID_LENGTH)} characters.`
    );
  }

  if (!SAFE_TRACK_ID_PATTERN.test(trackId)) {
    throw new CliUsageError(
      "Invalid track ID. Track IDs must contain only alphanumeric characters, hyphens, and underscores."
    );
  }
}

/**
 * Validates that the resolved track directory is a proper subdirectory of the expected parent.
 * The track directory must be strictly inside the parent (not equal to it).
 * This is a defense-in-depth check against path traversal.
 *
 * @param trackDir - The resolved track directory path (must be a subdirectory of expectedParent)
 * @param expectedParent - The expected parent directory
 * @throws CliRuntimeError if the path is not a proper subdirectory of the expected parent
 */
export function validateTrackPath(trackDir: string, expectedParent: string): void {
  const resolvedTrackDir = resolve(trackDir);
  const resolvedParent = resolve(expectedParent);

  // Ensure the resolved path starts with the expected parent + separator.
  // This requires trackDir to be a proper subdirectory - equality is rejected
  // because production code always constructs trackDir as parent/trackId.
  // This prevents escape via symlinks or other path manipulation.
  if (!resolvedTrackDir.startsWith(resolvedParent + sep)) {
    throw new CliRuntimeError(
      "Track directory path escapes the expected planning directory. This may indicate a path traversal attempt.",
      new Error(`Expected subdirectory of: ${resolvedParent}, Got: ${resolvedTrackDir}`)
    );
  }

  // Additional check: basename should match the track ID (no directory components)
  const trackDirBasename = basename(resolvedTrackDir);
  const expectedBasename = basename(trackDir);
  if (trackDirBasename !== expectedBasename) {
    throw new CliRuntimeError(
      "Track directory path manipulation detected.",
      new Error(`Expected basename: ${expectedBasename}, Got: ${trackDirBasename}`)
    );
  }
}

/** Planning outputs directory within .ship-spec/ */
const PLANNING_DIR = "planning";

/** Security warning banner for AI-generated content */
const UNTRUSTED_BANNER =
  `<!-- ⚠️ GENERATED FILE: UNTRUSTED CONTENT -->\n` +
  `<!-- This file contains AI-generated content. Review carefully before clicking links. -->\n\n` +
  `> **⚠️ SECURITY NOTICE**\n` +
  `> This is an AI-generated document. Review all content before use.\n\n`;

/**
 * Track metadata schema for validation.
 * Note: initialIdea must be non-empty. If metadata has an empty initialIdea,
 * validation fails and the checkpoint recovery path is triggered, which properly
 * handles corrupted or incomplete track data.
 */
const TrackMetadataSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  phase: z.enum(["clarifying", "prd_review", "spec_review", "complete"]),
  initialIdea: z.string().min(1, "initialIdea cannot be empty"),
  prdApproved: z.boolean(),
  specApproved: z.boolean(),
});

/**
 * Consent schema for cloud LLM data sharing.
 */
const ConsentSchema = z
  .object({
    cloudOk: z.literal(true),
    timestamp: z.string().optional(),
    version: z.number().int().optional(),
  })
  .strict();

/** Commander options shape (--no-save produces `save`, not `noSave`) */
interface CommanderPlanningOptions {
  track?: string;
  reindex?: boolean;
  save?: boolean; // Commander's negated flag: true by default, false when --no-save
  cloudOk?: boolean;
  localOnly?: boolean;
}

/**
 * Main planning action handler.
 */
async function planningAction(
  idea: string | undefined,
  cmdOpts: CommanderPlanningOptions
): Promise<void> {
  // Normalize Commander's `save` to our `noSave` convention
  const rawOptions = {
    track: cmdOpts.track,
    noSave: cmdOpts.save === false,
    reindex: cmdOpts.reindex ?? false,
    cloudOk: cmdOpts.cloudOk ?? false,
    localOnly: cmdOpts.localOnly ?? false,
  };

  // Validate options with Zod schema
  const parseResult = PlanningOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new CliUsageError(`Invalid planning options: ${errorMessages}`);
  }
  const options: PlanningOptions = parseResult.data;

  // 1. Fail-fast if not initialized
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    throw new CliUsageError("This directory has not been initialized. Run `ship-spec init` first.");
  }

  // 2. Load configuration
  const { config, secrets: loadedSecrets } = await loadConfig(
    projectRoot,
    {},
    { verbose: process.argv.includes("--verbose") }
  );

  // 3. Resolve API keys from keychain
  const secretsStore = createSecretsStore(projectRoot);
  const resolvedSecrets: ShipSpecSecrets = { ...loadedSecrets };

  if (config.llm.provider === "openrouter" && !resolvedSecrets.llmApiKey) {
    const openrouterKey = await secretsStore.get("OPENROUTER_API_KEY");
    if (!openrouterKey) {
      throw new CliUsageError(
        "OpenRouter API key not found. Run `ship-spec init` or set OPENROUTER_API_KEY."
      );
    }
    resolvedSecrets.llmApiKey = openrouterKey;
  }

  if (config.embedding.provider === "openrouter" && !resolvedSecrets.embeddingApiKey) {
    const openrouterKey = await secretsStore.get("OPENROUTER_API_KEY");
    if (!openrouterKey) {
      throw new CliUsageError(
        "OpenRouter API key not found. Run `ship-spec init` or set OPENROUTER_API_KEY."
      );
    }
    resolvedSecrets.embeddingApiKey = openrouterKey;
  }

  // 4. Update paths relative to initialized root
  config.projectPath = projectRoot;
  config.vectorDbPath = join(projectRoot, PROJECT_DIR, "lancedb");

  // 5. Check cloud consent
  await checkCloudConsent(config, options, projectRoot);

  // 6. Set up track directory with path traversal protection
  const trackId = options.track ?? randomUUID();

  // Validate user-provided track IDs to prevent path traversal attacks
  if (options.track) {
    validateTrackId(trackId);
  }

  const planningParentDir = join(projectRoot, PROJECT_DIR, PLANNING_DIR);
  const trackDir = join(planningParentDir, trackId);

  // Defense-in-depth: verify the resolved path doesn't escape the parent directory
  validateTrackPath(trackDir, planningParentDir);

  // Load existing track metadata if resuming
  let trackMetadata: TrackMetadata | null = null;
  const trackMetadataPath = join(trackDir, "track.json");
  // Flag to indicate if we should attempt checkpoint resume even without valid metadata
  let attemptCheckpointResume = false;

  if (options.track && existsSync(trackMetadataPath)) {
    try {
      const rawData: unknown = JSON.parse(await readFile(trackMetadataPath, "utf-8"));
      const parsed = TrackMetadataSchema.safeParse(rawData);
      if (parsed.success) {
        trackMetadata = parsed.data;
        logger.info(`Resuming planning track: ${chalk.cyan(trackId)}`);
      } else {
        // Metadata exists but is invalid - will check checkpoint below
        logger.warn("Invalid track metadata format.");
        attemptCheckpointResume = true;
      }
    } catch {
      // File exists but couldn't be read/parsed - will check checkpoint below
      logger.warn("Could not read track metadata.");
      attemptCheckpointResume = true;
    }
  } else if (options.track && !existsSync(trackMetadataPath)) {
    // User explicitly provided --track but metadata file doesn't exist
    // Will check checkpoint below
    logger.warn(`Track metadata not found at ${trackMetadataPath}`);
    attemptCheckpointResume = true;
  }

  // 7. Initialize repository for RAG (optional)
  let repository: DocumentRepository | null = null;

  if (existsSync(config.vectorDbPath)) {
    try {
      logger.progress("Initializing vector store for code context...");
      const vectorStore = new LanceDBManager(resolve(config.vectorDbPath));

      // Resolve embedding dimensions
      let resolvedDimensions: number;
      if (config.embedding.dimensions === "auto") {
        const probeEmbeddings = await createEmbeddingsModel(
          config.embedding,
          resolvedSecrets.embeddingApiKey
        );
        const probeVector = await probeEmbeddings.embedQuery("dimension probe");
        resolvedDimensions = probeVector.length;
      } else {
        resolvedDimensions = config.embedding.dimensions;
      }

      const resolvedEmbeddingConfig = { ...config.embedding, dimensions: resolvedDimensions };
      const resolvedConfig = { ...config, embedding: resolvedEmbeddingConfig };

      const embeddings = await createEmbeddingsModel(
        config.embedding,
        resolvedSecrets.embeddingApiKey
      );
      repository = new DocumentRepository(vectorStore, embeddings, resolvedDimensions);

      // Ensure index is fresh (always call ensureIndex for incremental change detection)
      const manifestPath = join(config.vectorDbPath, "index-manifest");
      logger.progress("Checking codebase index freshness...");
      const indexResult = await ensureIndex({
        config: resolvedConfig,
        repository,
        vectorStore,
        manifestPath,
        forceReindex: options.reindex,
      });

      if (indexResult.added > 0 || indexResult.modified > 0 || indexResult.removed > 0) {
        logger.info(
          `Index updated: ${String(indexResult.added)} added, ${String(indexResult.modified)} modified, ${String(indexResult.removed)} removed.`
        );
      } else {
        logger.info("Index is up to date.");
      }
    } catch (err) {
      logger.warn(`Failed to initialize code search: ${sanitizeError(err)}`);
      logger.info("Continuing without code context.");
      repository = null;
    }
  } else {
    logger.info("No existing index found. Running without code context.");
  }

  // 8. Set up checkpointer (REQUIRED for interrupt() to work)
  // Planning command always needs checkpointing because interrupt() requires it
  let checkpointer;
  try {
    checkpointer = createCheckpointer(config.checkpoint.type, config.checkpoint.sqlitePath);
  } catch (err) {
    throw new CliRuntimeError("Failed to initialize checkpointer", err);
  }

  // 9. Build the graph
  const graph = await createPlanningGraph(config, repository, {
    checkpointer,
    llmApiKey: resolvedSecrets.llmApiKey,
  });

  // Planning always uses checkpointing for interrupt() support
  const graphConfig = { configurable: { thread_id: trackId } };

  // 10. Determine initial idea and resumption state
  // Order of precedence:
  // 1. CLI argument (explicit user input, but empty string is treated as "no input")
  // 2. Track metadata (from track.json)
  // 3. Checkpoint state (if attempting checkpoint resume)
  // 4. Prompt user (only if none of the above)
  //
  // Normalize CLI input: treat empty/whitespace-only strings as "no input".
  // This prevents the bug where "" from CLI bypasses checkpoint/metadata values
  // but still triggers the user prompt, causing the prompted value to be discarded
  // when isResuming is already true.
  const normalizedIdea = idea?.trim() ? idea.trim() : undefined;
  let initialIdea = normalizedIdea ?? trackMetadata?.initialIdea;
  let isResuming = Boolean(options.track && trackMetadata);

  // If --track was provided but metadata failed, check if checkpoint exists BEFORE prompting user
  if (attemptCheckpointResume && !isResuming) {
    try {
      const existingState = await graph.getState(graphConfig);
      // Check if checkpoint has meaningful state (initialIdea is a good indicator)
      if (existingState.values && typeof existingState.values === "object") {
        const stateValues = existingState.values as Partial<PlanningStateType>;
        if (stateValues.initialIdea && stateValues.initialIdea.trim() !== "") {
          // Checkpoint exists with state - we can resume
          logger.info(
            `Found existing checkpoint for track ${chalk.cyan(trackId)}. Resuming from checkpoint.`
          );
          isResuming = true;
          // Use the initialIdea from checkpoint if user didn't provide one via CLI.
          // Explicitly check for empty string to treat it as "no input provided".
          if (!initialIdea?.trim()) {
            initialIdea = stateValues.initialIdea;
          }
        } else {
          // Checkpoint exists but has no initialIdea - corrupted or empty
          throw new CliUsageError(
            `Track '${trackId}' has corrupted or empty checkpoint data. ` +
              `Cannot resume this session. Start a new session without --track.`
          );
        }
      } else {
        // No checkpoint found for this track ID
        throw new CliUsageError(
          `No checkpoint found for track '${trackId}'. ` +
            `The session may have been deleted or never existed. ` +
            `Start a new session without --track.`
        );
      }
    } catch (err) {
      // If it's already a CliUsageError, rethrow it
      if (err instanceof CliUsageError) {
        throw err;
      }
      // Otherwise, wrap the error
      throw new CliUsageError(
        `Failed to check checkpoint for track '${trackId}': ${sanitizeError(err)}. ` +
          `Start a new session without --track.`
      );
    }
  }

  // 11. Prompt user for initial idea if not obtained from CLI, metadata, or checkpoint
  if (!initialIdea) {
    initialIdea = await input({
      message: "Describe what you want to build:",
    });
    if (!initialIdea.trim()) {
      throw new CliUsageError("An initial idea is required to start planning.");
    }
  }

  logger.progress(chalk.bold("\n🚀 Starting planning workflow...\n"));

  // 12. Create track directory (only if saving)
  if (!options.noSave) {
    await mkdir(trackDir, { recursive: true, mode: 0o700 });
  }

  // 13. Run graph with interrupt handling loop
  let result = (await graph.invoke(
    isResuming ? null : { initialIdea },
    graphConfig
  )) as PlanningResult;

  while (result.__interrupt__ && result.__interrupt__.length > 0) {
    const interruptObj = result.__interrupt__[0];
    if (!interruptObj) break;

    const interruptValue = interruptObj.value;

    if (interruptValue.type === "clarification") {
      // Handle clarification questions
      result = await handleClarificationInterrupt(graph, graphConfig, interruptValue);
    } else {
      // Handle document review (prd_review or spec_review)
      result = await handleDocumentReviewInterrupt(
        graph,
        graphConfig,
        trackDir,
        interruptValue,
        options.noSave
      );
    }
  }

  // 13. Write final artifacts (only if --no-save is not set)
  if (!options.noSave) {
    await writeTrackArtifacts(trackDir, trackId, initialIdea, result, trackMetadata);
    logger.success(chalk.green.bold("\n✅ Planning complete!"));
    logger.info(`Track ID: ${chalk.cyan(trackId)}`);
    logger.info(`Outputs: ${chalk.cyan(trackDir)}`);
    logger.info(`  - ${chalk.dim("context.md")} - Clarification history`);
    logger.info(`  - ${chalk.dim("prd.md")} - Product Requirements Document`);
    logger.info(`  - ${chalk.dim("tech-spec.md")} - Technical Specification`);
    logger.info(`  - ${chalk.dim("tasks.md")} - Implementation task prompts\n`);
  } else {
    // Print to stdout only
    logger.output("\n--- PRD ---\n");
    logger.output(result.prd ? redactText(result.prd) : "(not generated)");
    logger.output("\n--- TECH SPEC ---\n");
    logger.output(result.techSpec ? redactText(result.techSpec) : "(not generated)");
    logger.output("\n--- TASKS ---\n");
    logger.output(result.taskPrompts ? redactText(result.taskPrompts) : "(not generated)");
  }
}

/**
 * Checks and handles cloud LLM consent.
 */
async function checkCloudConsent(
  config: ShipSpecConfig,
  options: PlanningOptions,
  projectRoot: string
): Promise<void> {
  const isCloudLLM = config.llm.provider === "openrouter";
  const isCloudEmbedding = config.embedding.provider === "openrouter";

  if (options.localOnly && (isCloudLLM || isCloudEmbedding)) {
    const cloudDeps = [];
    if (isCloudLLM) cloudDeps.push(`LLM (${config.llm.provider})`);
    if (isCloudEmbedding) cloudDeps.push(`Embedding (${config.embedding.provider})`);
    throw new CliUsageError(
      `--local-only provided but cloud-based services are configured: ${cloudDeps.join(", ")}. ` +
        "Please use local-only providers (e.g., Ollama) or remove --local-only."
    );
  }

  const consentPath = join(projectRoot, PROJECT_DIR, "consent.json");
  let hasSavedConsent = false;

  if (existsSync(consentPath)) {
    try {
      const consentData: unknown = JSON.parse(await readFile(consentPath, "utf-8"));
      const parseResult = ConsentSchema.safeParse(consentData);
      if (parseResult.success) {
        hasSavedConsent = true;
      }
    } catch {
      // Invalid consent file, will prompt for new consent
    }
  }

  if ((isCloudLLM || isCloudEmbedding) && !options.cloudOk && !hasSavedConsent) {
    logger.warn("This command will send data to cloud-based LLM providers.");
    logger.warn("Providers involved:");
    if (isCloudLLM) logger.warn(`- LLM: ${config.llm.provider}`);
    if (isCloudEmbedding) logger.warn(`- Embedding: ${config.embedding.provider}`);
    logger.plain("");
    logger.plain("To proceed, you must explicitly acknowledge this data sharing:");
    logger.plain(chalk.cyan(`  ship-spec planning --cloud-ok`));
    logger.plain("");
    throw new CliUsageError("Data sharing consent required.");
  }

  // Save consent if --cloud-ok is provided
  if (options.cloudOk && !hasSavedConsent) {
    try {
      await writeFileAtomicNoFollow(
        consentPath,
        JSON.stringify(
          {
            cloudOk: true,
            timestamp: new Date().toISOString(),
            version: 1,
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
      logger.info("Cloud data sharing consent saved.");
    } catch (err) {
      logger.warn(`Failed to save consent: ${sanitizeError(err)}`);
    }
  }
}

/** Result type including possible interrupt */
type PlanningResult = PlanningStateType & {
  __interrupt__?: {
    id: string;
    value: InterruptPayload;
  }[];
};

/**
 * Handles clarification interrupt - prompts user for answers.
 */
async function handleClarificationInterrupt(
  graph: Awaited<ReturnType<typeof createPlanningGraph>>,
  graphConfig: { configurable?: { thread_id: string } },
  interruptPayload: ClarificationInterruptPayload
): Promise<PlanningResult> {
  logger.plain(chalk.yellow("\n📝 Clarifying questions:\n"));

  const answers: Record<string, string> = {};
  for (const [i, question] of interruptPayload.questions.entries()) {
    const answer = await input({
      message: `${String(i + 1)}. ${question}`,
    });
    answers[String(i)] = answer;
  }

  logger.plain("");

  return graph.invoke(
    new LangGraphCommand({ resume: answers }),
    graphConfig
  ) as Promise<PlanningResult>;
}

/**
 * Handles document review interrupt - writes document and prompts for feedback.
 */
async function handleDocumentReviewInterrupt(
  graph: Awaited<ReturnType<typeof createPlanningGraph>>,
  graphConfig: { configurable?: { thread_id: string } },
  trackDir: string,
  interruptPayload: DocumentReviewInterruptPayload,
  noSave: boolean
): Promise<PlanningResult> {
  const docType = interruptPayload.type === "prd_review" ? "PRD" : "Tech Spec";
  const fileName = interruptPayload.type === "prd_review" ? "prd.md" : "tech-spec.md";
  const docPath = join(trackDir, fileName);

  // Write document to track directory for review (unless --no-save)
  if (!noSave) {
    await writeFileAtomicNoFollow(
      docPath,
      UNTRUSTED_BANNER + redactText(interruptPayload.document),
      { mode: 0o600 }
    );
    logger.success(`\n${docType} written to: ${chalk.cyan(docPath)}`);
    logger.plain(chalk.dim(`Open the file to review, then respond below.\n`));
  } else {
    // Print document to stdout for review
    logger.output(`\n--- ${docType.toUpperCase()} ---\n`);
    logger.output(redactText(interruptPayload.document));
    logger.plain("");
  }

  const feedback = await input({
    message:
      interruptPayload.instructions + "\n" + chalk.dim("(Type 'approve' or provide feedback):"),
  });

  return graph.invoke(
    new LangGraphCommand({ resume: feedback }),
    graphConfig
  ) as Promise<PlanningResult>;
}

/**
 * Writes all track artifacts to disk.
 *
 * @param trackDir - Directory to write artifacts to
 * @param trackId - Unique track identifier
 * @param initialIdea - The initial idea/prompt from the user
 * @param state - Current planning state
 * @param existingMetadata - Optional existing metadata when resuming a session
 */
async function writeTrackArtifacts(
  trackDir: string,
  trackId: string,
  initialIdea: string,
  state: PlanningStateType,
  existingMetadata: TrackMetadata | null
): Promise<void> {
  // Write track metadata, preserving createdAt when resuming
  const metadata: TrackMetadata = {
    id: trackId,
    createdAt: existingMetadata?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phase: state.phase,
    initialIdea,
    prdApproved: state.phase === "spec_review" || state.phase === "complete",
    specApproved: state.phase === "complete",
  };

  await writeFileAtomicNoFollow(join(trackDir, "track.json"), JSON.stringify(metadata, null, 2), {
    mode: 0o600,
  });

  // Write context (clarification history)
  if (state.clarificationHistory.length > 0) {
    const contextContent =
      UNTRUSTED_BANNER +
      "# Clarification History\n\n" +
      state.clarificationHistory
        .map((entry) => `**Q:** ${entry.question}\n\n**A:** ${entry.answer}\n`)
        .join("\n---\n\n");

    await writeFileAtomicNoFollow(join(trackDir, "context.md"), redactText(contextContent), {
      mode: 0o600,
    });
  }

  // Write PRD
  if (state.prd) {
    await writeFileAtomicNoFollow(
      join(trackDir, "prd.md"),
      UNTRUSTED_BANNER + redactText(state.prd),
      { mode: 0o600 }
    );
  }

  // Write tech spec
  if (state.techSpec) {
    await writeFileAtomicNoFollow(
      join(trackDir, "tech-spec.md"),
      UNTRUSTED_BANNER + redactText(state.techSpec),
      { mode: 0o600 }
    );
  }

  // Write task prompts
  if (state.taskPrompts) {
    await writeFileAtomicNoFollow(
      join(trackDir, "tasks.md"),
      UNTRUSTED_BANNER + redactText(state.taskPrompts),
      { mode: 0o600 }
    );
  }
}

export const planningCommand = new Command("planning")
  .description("Plan a new feature or project with spec-driven development")
  .argument("[idea]", "High-level description of what to build")
  .option("--track <id>", "Resume an existing planning track")
  .option("--reindex", "Force re-index before planning")
  .option("--no-save", "Print outputs to stdout only, do not save to disk")
  .option("--cloud-ok", "Consent to sending data to cloud LLM providers")
  .option("--local-only", "Strictly refuse to use cloud-based providers")
  .action(planningAction);
