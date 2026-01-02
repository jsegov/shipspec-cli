import { mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Command as LangGraphCommand } from "@langchain/langgraph";

import { loadConfig, type ShipSpecSecrets } from "../config/loader.js";
import type { ShipSpecConfig } from "../config/schema.js";
import { LanceDBManager } from "../core/storage/vector-store.js";
import { DocumentRepository } from "../core/storage/repository.js";
import { createEmbeddingsModel } from "../core/models/embeddings.js";
import { ensureIndex } from "../core/indexing/ensure-index.js";
import { createPlanningGraph } from "../agents/planning/graph.js";
import type { PlanningStateType } from "../agents/planning/state.js";
import {
  PlanningOptionsSchema,
  type TrackMetadata,
  type PlanningOptions,
  type InterruptPayload,
} from "../agents/planning/types.js";
import { createCheckpointer } from "../core/checkpoint/index.js";
import { createSecretsStore } from "../core/secrets/secrets-store.js";
import { redactText } from "../utils/redaction.js";
import { writeFileAtomicNoFollow } from "../utils/safe-write.js";
import { logger, sanitizeError } from "../utils/logger.js";
import { CliRuntimeError, CliUsageError } from "../cli/errors.js";
import type { InterruptResponse, RpcEvent } from "../backend/protocol.js";
import { applyProjectPaths, resolveProjectRoot } from "./shared.js";
import { PROJECT_DIR } from "../core/project/project-state.js";

const MAX_TRACK_ID_LENGTH = 128;
const SAFE_TRACK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const ConsentSchema = z
  .object({
    cloudOk: z.literal(true),
    timestamp: z.string().optional(),
    version: z.number().int().optional(),
  })
  .strict();

const TrackMetadataSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  phase: z.enum(["clarifying", "prd_review", "spec_review", "complete"]),
  initialIdea: z.string().min(1, "initialIdea cannot be empty"),
  prdApproved: z.boolean(),
  specApproved: z.boolean(),
});

const UNTRUSTED_BANNER =
  `<!-- WARNING: GENERATED FILE: UNTRUSTED CONTENT -->\n` +
  `<!-- This file contains AI-generated content. Review carefully before clicking links. -->\n\n` +
  `> **SECURITY NOTICE**\n` +
  `> This is an AI-generated document. Review all content before use.\n\n`;

export interface PlanningSessionOptions {
  idea?: string;
  trackId?: string;
  reindex?: boolean;
  noSave?: boolean;
  cloudOk?: boolean;
  localOnly?: boolean;
}

type PlanningResult = PlanningStateType & {
  __interrupt__?: {
    id: string;
    value: InterruptPayload;
  }[];
};

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

function validateTrackPath(trackDir: string, expectedParent: string): void {
  const resolvedTrackDir = resolve(trackDir);
  const resolvedParent = resolve(expectedParent);

  if (!resolvedTrackDir.startsWith(resolvedParent + sep)) {
    throw new CliRuntimeError(
      "Track directory path escapes the expected planning directory. This may indicate a path traversal attempt.",
      new Error(`Expected subdirectory of: ${resolvedParent}, Got: ${resolvedTrackDir}`)
    );
  }

  const trackDirBasename = basename(resolvedTrackDir);
  const expectedBasename = basename(trackDir);
  if (trackDirBasename !== expectedBasename) {
    throw new CliRuntimeError(
      "Track directory path manipulation detected.",
      new Error(`Expected basename: ${expectedBasename}, Got: ${trackDirBasename}`)
    );
  }
}

async function checkCloudConsent(
  config: ShipSpecConfig,
  options: PlanningOptions,
  projectRoot: string
): Promise<void> {
  const isCloudLLM = config.llm.provider === "openrouter";
  const isCloudEmbedding = config.embedding.provider === "openrouter";

  if (options.localOnly && (isCloudLLM || isCloudEmbedding)) {
    const cloudDeps: string[] = [];
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
    throw new CliUsageError(
      "Data sharing consent required. Run `ship-spec planning --cloud-ok` to persist consent."
    );
  }

  if (options.cloudOk && !hasSavedConsent) {
    try {
      await mkdir(dirname(consentPath), { recursive: true, mode: 0o700 });
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

async function writeTrackArtifacts(
  trackDir: string,
  trackId: string,
  initialIdea: string,
  state: PlanningStateType,
  existingMetadata: TrackMetadata | null
): Promise<void> {
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

  if (state.prd) {
    await writeFileAtomicNoFollow(
      join(trackDir, "prd.md"),
      UNTRUSTED_BANNER + redactText(state.prd),
      {
        mode: 0o600,
      }
    );
  }

  if (state.techSpec) {
    await writeFileAtomicNoFollow(
      join(trackDir, "tech-spec.md"),
      UNTRUSTED_BANNER + redactText(state.techSpec),
      { mode: 0o600 }
    );
  }

  if (state.taskPrompts) {
    await writeFileAtomicNoFollow(
      join(trackDir, "tasks.md"),
      UNTRUSTED_BANNER + redactText(state.taskPrompts),
      { mode: 0o600 }
    );
  }
}

export interface PlanningSession {
  trackId: string;
  start: () => AsyncGenerator<RpcEvent>;
  resume: (response: InterruptResponse) => AsyncGenerator<RpcEvent>;
}

export async function createPlanningSession(
  options: PlanningSessionOptions
): Promise<PlanningSession> {
  const normalizedOptions = {
    track: options.trackId,
    reindex: options.reindex ?? false,
    noSave: options.noSave ?? false,
    cloudOk: options.cloudOk ?? false,
    localOnly: options.localOnly ?? false,
  };

  const parseResult = PlanningOptionsSchema.safeParse(normalizedOptions);
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    throw new CliUsageError(`Invalid planning options: ${errorMessages}`);
  }
  const validatedOptions = parseResult.data;

  const projectRoot = resolveProjectRoot();
  const { config, secrets: loadedSecrets } = await loadConfig(
    projectRoot,
    {},
    { verbose: process.argv.includes("--verbose") }
  );

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

  const resolvedConfig = applyProjectPaths(config, projectRoot);
  await checkCloudConsent(resolvedConfig, validatedOptions, projectRoot);

  const trackId = options.trackId ?? randomUUID();
  if (options.trackId) {
    validateTrackId(trackId);
  }

  const planningParentDir = join(projectRoot, PROJECT_DIR, "planning");
  const trackDir = join(planningParentDir, trackId);
  validateTrackPath(trackDir, planningParentDir);

  let trackMetadata: TrackMetadata | null = null;
  const trackMetadataPath = join(trackDir, "track.json");
  let attemptCheckpointResume = false;

  if (options.trackId && existsSync(trackMetadataPath)) {
    try {
      const rawData: unknown = JSON.parse(await readFile(trackMetadataPath, "utf-8"));
      const parsed = TrackMetadataSchema.safeParse(rawData);
      if (parsed.success) {
        trackMetadata = parsed.data;
      } else {
        attemptCheckpointResume = true;
      }
    } catch {
      attemptCheckpointResume = true;
    }
  } else if (options.trackId && !existsSync(trackMetadataPath)) {
    attemptCheckpointResume = true;
  }

  let repository: DocumentRepository | null = null;
  if (existsSync(resolvedConfig.vectorDbPath)) {
    try {
      const vectorStore = new LanceDBManager(resolve(resolvedConfig.vectorDbPath));

      let resolvedDimensions: number;
      if (resolvedConfig.embedding.dimensions === "auto") {
        const probeEmbeddings = await createEmbeddingsModel(
          resolvedConfig.embedding,
          resolvedSecrets.embeddingApiKey
        );
        const probeVector = await probeEmbeddings.embedQuery("dimension probe");
        resolvedDimensions = probeVector.length;
      } else {
        resolvedDimensions = resolvedConfig.embedding.dimensions;
      }

      const resolvedEmbeddingConfig = {
        ...resolvedConfig.embedding,
        dimensions: resolvedDimensions,
      };
      const resolvedConfigWithEmbedding = { ...resolvedConfig, embedding: resolvedEmbeddingConfig };

      const embeddings = await createEmbeddingsModel(
        resolvedConfig.embedding,
        resolvedSecrets.embeddingApiKey
      );
      repository = new DocumentRepository(vectorStore, embeddings, resolvedDimensions);

      const manifestPath = join(resolvedConfig.vectorDbPath, "index-manifest");
      await ensureIndex({
        config: resolvedConfigWithEmbedding,
        repository,
        vectorStore,
        manifestPath,
        forceReindex: validatedOptions.reindex,
      });
    } catch (err) {
      logger.warn(`Failed to initialize code search: ${sanitizeError(err)}`);
      repository = null;
    }
  }

  let checkpointer;
  try {
    checkpointer = createCheckpointer(
      resolvedConfig.checkpoint.type,
      resolvedConfig.checkpoint.sqlitePath
    );
  } catch (err) {
    throw new CliRuntimeError("Failed to initialize checkpointer", err);
  }

  const graph = await createPlanningGraph(resolvedConfig, repository, {
    checkpointer,
    llmApiKey: resolvedSecrets.llmApiKey,
  });

  const graphConfig = { configurable: { thread_id: trackId } };

  const normalizedIdea = options.idea?.trim() ? options.idea.trim() : undefined;
  let initialIdea = normalizedIdea ?? trackMetadata?.initialIdea;
  let isResuming = Boolean(options.trackId && trackMetadata);

  if (attemptCheckpointResume && !isResuming) {
    try {
      const existingState = await graph.getState(graphConfig);
      if (existingState.values && typeof existingState.values === "object") {
        const stateValues = existingState.values as Partial<PlanningStateType>;
        if (stateValues.initialIdea && stateValues.initialIdea.trim() !== "") {
          isResuming = true;
          if (!initialIdea?.trim()) {
            initialIdea = stateValues.initialIdea;
          }
        } else {
          throw new CliUsageError(
            `Track '${trackId}' has corrupted or empty checkpoint data. ` +
              `Cannot resume this session. Start a new session without --track.`
          );
        }
      } else {
        throw new CliUsageError(
          `No checkpoint found for track '${trackId}'. ` +
            `The session may have been deleted or never existed. ` +
            `Start a new session without --track.`
        );
      }
    } catch (err) {
      if (err instanceof CliUsageError) {
        throw err;
      }
      throw new CliUsageError(
        `Failed to check checkpoint for track '${trackId}': ${sanitizeError(err)}. ` +
          `Start a new session without --track.`
      );
    }
  }

  if (!initialIdea && !isResuming) {
    throw new CliUsageError("An initial idea is required to start planning.");
  }

  if (!validatedOptions.noSave) {
    await mkdir(trackDir, { recursive: true, mode: 0o700 });
  }

  const emitInterrupt = async function* (payload: InterruptPayload): AsyncGenerator<RpcEvent> {
    switch (payload.type) {
      case "clarification":
        yield {
          type: "interrupt",
          payload: { kind: "clarification", questions: payload.questions },
        };
        return;
      case "prd_review":
      case "spec_review": {
        const docType = payload.type === "prd_review" ? "prd" : "spec";
        const fileName = payload.type === "prd_review" ? "prd.md" : "tech-spec.md";
        const docPath = join(trackDir, fileName);

        if (!validatedOptions.noSave) {
          await writeFileAtomicNoFollow(docPath, UNTRUSTED_BANNER + redactText(payload.document), {
            mode: 0o600,
          });
        }

        yield {
          type: "interrupt",
          payload: {
            kind: "document_review",
            docType,
            content: payload.document,
            instructions: payload.instructions,
          },
        };
        return;
      }
      default: {
        const _exhaustive: never = payload;
        throw new CliRuntimeError("Unhandled planning interrupt type.");
      }
    }
  };

  const handleResult = async function* (result: PlanningResult): AsyncGenerator<RpcEvent> {
    if (result.__interrupt__ && result.__interrupt__.length > 0) {
      const interruptObj = result.__interrupt__[0];
      if (!interruptObj) {
        throw new CliRuntimeError("Planning interrupt payload missing.");
      }
      yield* emitInterrupt(interruptObj.value);
      return;
    }

    if (!validatedOptions.noSave && initialIdea) {
      await writeTrackArtifacts(trackDir, trackId, initialIdea, result, trackMetadata);
    }

    yield {
      type: "complete",
      result: {
        trackId,
        trackDir,
        phase: result.phase,
        prd: result.prd,
        techSpec: result.techSpec,
        taskPrompts: result.taskPrompts,
      },
    };
  };

  const start = async function* (): AsyncGenerator<RpcEvent> {
    yield { type: "status", message: "Starting planning workflow..." };
    const result = (await graph.invoke(
      isResuming ? null : { initialIdea },
      graphConfig
    )) as PlanningResult;
    yield* handleResult(result);
  };

  const resume = async function* (response: InterruptResponse): AsyncGenerator<RpcEvent> {
    const result = (await graph.invoke(
      new LangGraphCommand({ resume: response }),
      graphConfig
    )) as PlanningResult;
    yield* handleResult(result);
  };

  return {
    trackId,
    start,
    resume,
  };
}
