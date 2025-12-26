/**
 * Planning Command
 * Guides users through spec-driven development, producing PRD, Tech Spec, and Task List.
 * Uses LangGraph interrupts for human-in-the-loop review cycles.
 */

import { Command } from "commander";
import { mkdir, readFile } from "fs/promises";
import { resolve, join } from "path";
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
import type {
  TrackMetadata,
  PlanningOptions,
  InterruptPayload,
  ClarificationInterruptPayload,
  DocumentReviewInterruptPayload,
} from "../../agents/planning/types.js";
import { createCheckpointer } from "../../core/checkpoint/index.js";
import { logger, sanitizeError } from "../../utils/logger.js";
import { CliUsageError, CliRuntimeError } from "../errors.js";
import { findProjectRoot, PROJECT_DIR } from "../../core/project/project-state.js";
import { createSecretsStore } from "../../core/secrets/secrets-store.js";
import { redactText } from "../../utils/redaction.js";
import { writeFileAtomicNoFollow } from "../../utils/safe-write.js";
import { z } from "zod";

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
 */
const TrackMetadataSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  phase: z.enum(["clarifying", "prd_review", "spec_review", "complete"]),
  initialIdea: z.string(),
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

/**
 * Main planning action handler.
 */
async function planningAction(idea: string | undefined, options: PlanningOptions): Promise<void> {
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

  // 6. Set up track directory
  const trackId = options.track ?? randomUUID();
  const trackDir = join(projectRoot, PROJECT_DIR, PLANNING_DIR, trackId);

  // Load existing track metadata if resuming
  let trackMetadata: TrackMetadata | null = null;
  const trackMetadataPath = join(trackDir, "track.json");

  if (options.track && existsSync(trackMetadataPath)) {
    try {
      const rawData: unknown = JSON.parse(await readFile(trackMetadataPath, "utf-8"));
      const parsed = TrackMetadataSchema.safeParse(rawData);
      if (parsed.success) {
        trackMetadata = parsed.data;
        logger.info(`Resuming planning track: ${chalk.cyan(trackId)}`);
      } else {
        logger.warn("Invalid track metadata, starting fresh.");
      }
    } catch {
      logger.warn("Could not read track metadata, starting fresh.");
    }
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

      // Ensure index is fresh
      if (options.reindex || !existsSync(join(config.vectorDbPath, "index-manifest"))) {
        const manifestPath = join(config.vectorDbPath, "index-manifest");
        await ensureIndex({
          config: resolvedConfig,
          repository,
          vectorStore,
          manifestPath,
          forceReindex: options.reindex,
        });
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

  // 10. Get initial idea
  let initialIdea = idea ?? trackMetadata?.initialIdea;
  if (!initialIdea) {
    initialIdea = await input({
      message: "Describe what you want to build:",
    });
    if (!initialIdea.trim()) {
      throw new CliUsageError("An initial idea is required to start planning.");
    }
  }

  logger.progress(chalk.bold("\n🚀 Starting planning workflow...\n"));

  // 11. Create track directory (only if saving)
  if (!options.noSave) {
    await mkdir(trackDir, { recursive: true, mode: 0o700 });
  }

  // 12. Run graph with interrupt handling loop
  // When resuming (options.track is set), pass null to let LangGraph load checkpointed state
  // When starting fresh, pass { initialIdea } to initialize the workflow
  const isResuming = Boolean(options.track && trackMetadata);
  let result = (await graph.invoke(
    isResuming ? null : { initialIdea },
    graphConfig
  )) as PlanningStateType & {
    __interrupt__?: InterruptPayload[];
  };

  while (result.__interrupt__ && result.__interrupt__.length > 0) {
    const interruptValue = result.__interrupt__[0];
    if (!interruptValue) break;

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
    await writeTrackArtifacts(trackDir, trackId, initialIdea, result);
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
    logger.output(redactText(result.prd));
    logger.output("\n--- TECH SPEC ---\n");
    logger.output(redactText(result.techSpec));
    logger.output("\n--- TASKS ---\n");
    logger.output(redactText(result.taskPrompts));
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
type PlanningResult = PlanningStateType & { __interrupt__?: InterruptPayload[] };

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
 */
async function writeTrackArtifacts(
  trackDir: string,
  trackId: string,
  initialIdea: string,
  state: PlanningStateType
): Promise<void> {
  // Write track metadata
  const metadata: TrackMetadata = {
    id: trackId,
    createdAt: new Date().toISOString(),
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
  .option("--checkpoint", "Enable checkpointing for resumable sessions")
  .option("--reindex", "Force re-index before planning")
  .option("--no-save", "Print outputs to stdout only, do not save to disk")
  .option("--cloud-ok", "Consent to sending data to cloud LLM providers")
  .option("--local-only", "Strictly refuse to use cloud-based providers")
  .action(planningAction);
