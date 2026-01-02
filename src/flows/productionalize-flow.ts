import { mkdir, readdir, unlink } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { randomUUID } from "node:crypto";
import { format } from "date-fns";
import { z } from "zod";
import { Command as LangGraphCommand } from "@langchain/langgraph";

import { loadConfig, type ShipSpecSecrets } from "../config/loader.js";
import type { ShipSpecConfig } from "../config/schema.js";
import { LanceDBManager } from "../core/storage/vector-store.js";
import { DocumentRepository } from "../core/storage/repository.js";
import { createEmbeddingsModel } from "../core/models/embeddings.js";
import { ensureIndex } from "../core/indexing/ensure-index.js";
import { createProductionalizeGraph } from "../agents/productionalize/graph.js";
import type { ProductionalizeStateType } from "../agents/productionalize/state.js";
import { type ProductionalizeInterruptPayload } from "../agents/productionalize/types.js";
import { createCheckpointer } from "../core/checkpoint/index.js";
import { createSecretsStore } from "../core/secrets/secrets-store.js";
import { redactText } from "../utils/redaction.js";
import { writeFileAtomicNoFollow } from "../utils/safe-write.js";
import { logger, sanitizeError } from "../utils/logger.js";
import { CliRuntimeError, CliUsageError } from "../cli/errors.js";
import type { InterruptResponse, RpcEvent } from "../backend/protocol.js";
import { applyProjectPaths, resolveProjectRoot } from "./shared.js";
import { OUTPUTS_DIR, PROJECT_DIR } from "../core/project/project-state.js";

const ConsentSchema = z
  .object({
    cloudOk: z.literal(true),
    timestamp: z.string().optional(),
    version: z.number().int().optional(),
  })
  .strict();

const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const UNTRUSTED_BANNER =
  `<!-- WARNING: GENERATED FILE: UNTRUSTED CONTENT -->\n` +
  `<!-- This file contains AI-generated content. Review carefully before clicking links. -->\n\n` +
  `> **SECURITY NOTICE**\n` +
  `> This is an AI-generated report. Review all links and recommendations before use.\n\n`;

export interface ProductionalizeSessionOptions {
  context?: string;
  sessionId?: string;
  reindex?: boolean;
  enableScans?: boolean;
  categories?: string;
  cloudOk?: boolean;
  localOnly?: boolean;
  noSave?: boolean;
}

export function validateSessionId(sessionId: string): void {
  if (!SAFE_SESSION_ID_PATTERN.test(sessionId)) {
    throw new CliUsageError(
      "Invalid session ID. Must be 1-64 characters and contain only alphanumeric, '.', '_', or '-'."
    );
  }
}

type ProductionalizeResult = ProductionalizeStateType & {
  __interrupt__?: {
    id: string;
    value: ProductionalizeInterruptPayload;
  }[];
};

async function checkCloudConsent(
  config: ShipSpecConfig,
  options: ProductionalizeSessionOptions,
  projectRoot: string,
  hasTavily: boolean
): Promise<void> {
  const cloudProviders = ["openrouter"];
  const isCloudLLM = cloudProviders.includes(config.llm.provider);
  const isCloudEmbedding = cloudProviders.includes(config.embedding.provider);
  const isCloudSearch = config.productionalize.webSearch?.provider !== "duckduckgo" && hasTavily;

  if (options.localOnly && (isCloudLLM || isCloudEmbedding || isCloudSearch)) {
    const cloudDeps: string[] = [];
    if (isCloudLLM) cloudDeps.push(`LLM (${config.llm.provider})`);
    if (isCloudEmbedding) cloudDeps.push(`Embedding (${config.embedding.provider})`);
    if (isCloudSearch) cloudDeps.push("Web Search (Tavily)");
    throw new CliUsageError(
      `--local-only provided but cloud-based services are configured: ${cloudDeps.join(", ")}. ` +
        "Please use local-only providers (e.g., Ollama) or remove --local-only."
    );
  }

  const consentPath = join(projectRoot, PROJECT_DIR, "consent.json");
  let hasSavedConsent = false;
  if (existsSync(consentPath)) {
    try {
      const consentData: unknown = JSON.parse(readFileSync(consentPath, "utf-8"));
      const parseResult = ConsentSchema.safeParse(consentData);
      if (parseResult.success) {
        hasSavedConsent = true;
      }
    } catch {
      // Invalid consent file will be handled by prompt below
    }
  }

  if ((isCloudLLM || isCloudEmbedding || isCloudSearch) && !options.cloudOk && !hasSavedConsent) {
    throw new CliUsageError(
      "Data sharing consent required. Run `ship-spec productionalize --cloud-ok` to persist consent."
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
      logger.info("Cloud data sharing consent saved to .ship-spec/consent.json");
    } catch (err) {
      logger.warn(`Failed to save consent: ${sanitizeError(err)}`);
    }
  }
}

async function pruneOutputs(outputsDir: string, limit: number): Promise<void> {
  if (typeof limit !== "number" || Number.isNaN(limit) || limit < 1) {
    logger.warn(`Invalid keep-outputs limit (${String(limit)}), skipping pruning`);
    return;
  }

  try {
    const files = await readdir(outputsDir);
    const reports = files
      .filter((f) => f.startsWith("report-") && f.endsWith(".md"))
      .sort()
      .reverse();
    const prompts = files
      .filter((f) => f.startsWith("task-prompts-") && f.endsWith(".md"))
      .sort()
      .reverse();

    if (reports.length > limit) {
      for (const file of reports.slice(limit)) {
        await unlink(join(outputsDir, file));
      }
    }
    if (prompts.length > limit) {
      for (const file of prompts.slice(limit)) {
        await unlink(join(outputsDir, file));
      }
    }
  } catch (err) {
    logger.warn(`Failed to prune old outputs: ${sanitizeError(err)}`);
  }
}

export interface ProductionalizeSession {
  sessionId: string;
  start: () => AsyncGenerator<RpcEvent>;
  resume: (response: InterruptResponse) => AsyncGenerator<RpcEvent>;
}

export async function createProductionalizeSession(
  options: ProductionalizeSessionOptions
): Promise<ProductionalizeSession> {
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

  if (
    !resolvedSecrets.tavilyApiKey &&
    config.productionalize.webSearch?.provider !== "duckduckgo"
  ) {
    const tavilyKey = await secretsStore.get("TAVILY_API_KEY");
    if (tavilyKey) {
      resolvedSecrets.tavilyApiKey = tavilyKey;
    }
  }

  const resolvedConfig = applyProjectPaths(config, projectRoot);

  if (options.enableScans) {
    const sast = resolvedConfig.productionalize.sast ?? { enabled: false, tools: [] };
    sast.enabled = true;
    if (sast.tools.length === 0) {
      sast.tools = ["semgrep", "gitleaks", "trivy"];
    }
    resolvedConfig.productionalize.sast = sast;
  }

  if (options.categories) {
    resolvedConfig.productionalize.coreCategories = options.categories
      .split(",")
      .map((c) => c.trim());
  }

  const sessionId = options.sessionId ?? randomUUID();
  if (options.sessionId) {
    validateSessionId(options.sessionId);
  }

  await checkCloudConsent(resolvedConfig, options, projectRoot, !!resolvedSecrets.tavilyApiKey);

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

  const resolvedEmbeddingConfig = { ...resolvedConfig.embedding, dimensions: resolvedDimensions };
  const resolvedConfigWithEmbedding = { ...resolvedConfig, embedding: resolvedEmbeddingConfig };

  const embeddings = await createEmbeddingsModel(
    resolvedConfig.embedding,
    resolvedSecrets.embeddingApiKey
  );
  const repository = new DocumentRepository(vectorStore, embeddings, resolvedDimensions);

  const manifestPath = join(resolve(resolvedConfig.vectorDbPath), "index-manifest");
  try {
    await ensureIndex({
      config: resolvedConfigWithEmbedding,
      repository,
      vectorStore,
      manifestPath,
      forceReindex: options.reindex ?? false,
    });
  } catch (err) {
    throw new CliRuntimeError("Indexing failed", err);
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

  const graph = await createProductionalizeGraph(resolvedConfig, repository, {
    checkpointer,
    llmApiKey: resolvedSecrets.llmApiKey,
    searchApiKey: resolvedSecrets.tavilyApiKey,
    shouldRedactCloud: resolvedConfig.llm.provider === "openrouter",
  });

  const graphConfig = {
    configurable: {
      thread_id: sessionId,
    },
  };

  const initialState = {
    userQuery: options.context ?? "Perform a full production-readiness analysis of this codebase.",
    interactiveMode: true,
  };

  const emitInterrupt = function* (payload: ProductionalizeInterruptPayload): Generator<RpcEvent> {
    switch (payload.type) {
      case "interview":
        yield { type: "interrupt", payload: { kind: "interview", questions: payload.questions } };
        return;
      case "report_review":
        yield {
          type: "interrupt",
          payload: {
            kind: "document_review",
            docType: "report",
            content: payload.report,
            instructions: "Review the report and reply with 'approve' or feedback.",
          },
        };
        return;
      case "worker_clarification":
        yield {
          type: "interrupt",
          payload: {
            kind: "clarification",
            questions: [
              `Clarification needed for ${payload.category}: ${payload.findingContext}`,
              ...payload.questions,
            ],
          },
        };
        return;
      default: {
        const _exhaustive: never = payload;
        throw new CliRuntimeError("Unhandled productionalize interrupt type.");
      }
    }
  };

  const handleResult = async function* (result: ProductionalizeResult): AsyncGenerator<RpcEvent> {
    if (result.__interrupt__ && result.__interrupt__.length > 0) {
      const interruptObj = result.__interrupt__[0];
      if (!interruptObj) {
        throw new CliRuntimeError("Productionalize interrupt payload missing.");
      }
      yield* emitInterrupt(interruptObj.value);
      return;
    }

    if (!options.noSave) {
      const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
      const outputsDir = join(projectRoot, PROJECT_DIR, OUTPUTS_DIR);
      const reportPath = join(outputsDir, `report-${timestamp}.md`);
      const promptsPath = join(outputsDir, `task-prompts-${timestamp}.md`);

      if (!existsSync(outputsDir)) {
        await mkdir(outputsDir, { recursive: true, mode: 0o700 });
      }

      const redactedReport = UNTRUSTED_BANNER + redactText(result.finalReport);
      const redactedPrompts = UNTRUSTED_BANNER + redactText(result.taskPrompts);

      await writeFileAtomicNoFollow(reportPath, redactedReport, { mode: 0o600 });
      await writeFileAtomicNoFollow(promptsPath, redactedPrompts, { mode: 0o600 });

      const latestReportPath = join(projectRoot, PROJECT_DIR, "latest-report.md");
      const latestPromptsPath = join(projectRoot, PROJECT_DIR, "latest-task-prompts.md");

      await writeFileAtomicNoFollow(latestReportPath, redactedReport, { mode: 0o600 });
      await writeFileAtomicNoFollow(latestPromptsPath, redactedPrompts, { mode: 0o600 });

      await pruneOutputs(outputsDir, 10);
    }

    yield {
      type: "complete",
      result: {
        sessionId,
        finalReport: result.finalReport,
        taskPrompts: result.taskPrompts,
      },
    };
  };

  const start = async function* (): AsyncGenerator<RpcEvent> {
    yield { type: "status", message: "Starting production-readiness analysis..." };
    const result = (await graph.invoke(initialState, graphConfig)) as ProductionalizeResult;
    yield* handleResult(result);
  };

  const resume = async function* (response: InterruptResponse): AsyncGenerator<RpcEvent> {
    const result = (await graph.invoke(
      new LangGraphCommand({ resume: response }),
      graphConfig
    )) as ProductionalizeResult;
    yield* handleResult(result);
  };

  return {
    sessionId,
    start,
    resume,
  };
}
