import { mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import { SystemMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { loadConfig, type ShipSpecSecrets } from "../config/loader.js";
import type { ShipSpecConfig } from "../config/schema.js";
import { createEmbeddingsModel } from "../core/models/embeddings.js";
import { createChatModel } from "../core/models/llm.js";
import { ensureIndex } from "../core/indexing/ensure-index.js";
import { LanceDBManager } from "../core/storage/vector-store.js";
import { DocumentRepository } from "../core/storage/repository.js";
import { createSecretsStore } from "../core/secrets/secrets-store.js";
import {
  ASK_SYSTEM_TEMPLATE,
  NO_CONTEXT_RESPONSE,
  formatCodeContext,
  buildAskPrompt,
  summarizeHistory,
  type ConversationEntry,
} from "../agents/prompts/ask-templates.js";
import {
  pruneChunksByTokenBudget,
  countTokensApprox,
  getAvailableContextBudget,
  type TokenBudget,
} from "../utils/tokens.js";
import { logger, sanitizeError } from "../utils/logger.js";
import { writeFileAtomicNoFollow } from "../utils/safe-write.js";
import { CliRuntimeError, CliUsageError } from "../cli/errors.js";
import type { RpcEvent } from "../backend/protocol.js";
import { applyProjectPaths, resolveProjectRoot } from "./shared.js";
import { PROJECT_DIR } from "../core/project/project-state.js";

const ConsentSchema = z
  .object({
    cloudOk: z.literal(true),
    timestamp: z.string().optional(),
    version: z.number().int().optional(),
  })
  .strict();

export interface AskContextOptions {
  reindex?: boolean;
  cloudOk?: boolean;
  localOnly?: boolean;
  verbose?: boolean;
}

export interface AskContext {
  config: ShipSpecConfig;
  secrets: ShipSpecSecrets;
  repository: DocumentRepository;
  model: BaseChatModel;
  tokenBudget: TokenBudget;
}

export interface AskFlowInput {
  question: string;
  history?: ConversationEntry[];
  options?: AskContextOptions;
  context?: AskContext;
  abortSignal?: AbortSignal;
}

type StatusEmitter = (message: string) => void;

async function initializeRepository(
  config: ShipSpecConfig,
  secrets: ShipSpecSecrets,
  forceReindex: boolean,
  emitStatus?: StatusEmitter
): Promise<DocumentRepository> {
  emitStatus?.("Initializing vector store...");
  const vectorStore = new LanceDBManager(resolve(config.vectorDbPath));

  let resolvedDimensions: number;
  if (config.embedding.dimensions === "auto") {
    const probeEmbeddings = await createEmbeddingsModel(config.embedding, secrets.embeddingApiKey);
    const probeVector = await probeEmbeddings.embedQuery("dimension probe");
    resolvedDimensions = probeVector.length;
  } else {
    resolvedDimensions = config.embedding.dimensions;
  }

  const resolvedEmbeddingConfig = { ...config.embedding, dimensions: resolvedDimensions };
  const resolvedConfig = { ...config, embedding: resolvedEmbeddingConfig };

  const embeddings = await createEmbeddingsModel(resolvedEmbeddingConfig, secrets.embeddingApiKey);
  const repository = new DocumentRepository(vectorStore, embeddings, resolvedDimensions);

  const manifestPath = join(config.vectorDbPath, "index-manifest");
  emitStatus?.("Checking codebase index freshness...");
  const indexResult = await ensureIndex({
    config: resolvedConfig,
    repository,
    vectorStore,
    manifestPath,
    forceReindex,
  });

  if (indexResult.added > 0 || indexResult.modified > 0 || indexResult.removed > 0) {
    emitStatus?.(
      `Index updated: ${String(indexResult.added)} added, ${String(
        indexResult.modified
      )} modified, ${String(indexResult.removed)} removed.`
    );
  } else {
    emitStatus?.("Index is up to date.");
  }

  return repository;
}

async function checkCloudConsent(
  config: ShipSpecConfig,
  options: AskContextOptions,
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
      "Data sharing consent required. Run `ship-spec ask --cloud-ok` or `ship-spec planning --cloud-ok` to persist consent."
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

export async function createAskContext(
  options: AskContextOptions = {},
  emitStatus?: StatusEmitter
): Promise<AskContext> {
  const projectRoot = resolveProjectRoot();
  const { config, secrets: loadedSecrets } = await loadConfig(
    projectRoot,
    {},
    { verbose: options.verbose ?? process.argv.includes("--verbose") }
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

  await checkCloudConsent(resolvedConfig, options, projectRoot);

  const repository = await initializeRepository(
    resolvedConfig,
    resolvedSecrets,
    options.reindex ?? false,
    emitStatus
  );
  const model = await createChatModel(resolvedConfig.llm, resolvedSecrets.llmApiKey);
  const tokenBudget: TokenBudget = {
    maxContextTokens: resolvedConfig.llm.maxContextTokens,
    reservedOutputTokens: resolvedConfig.llm.reservedOutputTokens,
  };

  return {
    config: resolvedConfig,
    secrets: resolvedSecrets,
    repository,
    model,
    tokenBudget,
  };
}

export async function* askFlow(input: AskFlowInput): AsyncGenerator<RpcEvent> {
  const history = input.history ?? [];
  let context = input.context;

  if (!context) {
    yield { type: "status", message: "Preparing ask environment..." };
    context = await createAskContext(input.options ?? {});
  }

  yield { type: "status", message: "Searching codebase..." };
  const rawChunks = await context.repository.hybridSearch(input.question, 10);

  if (rawChunks.length === 0) {
    yield { type: "complete", result: { answer: NO_CONTEXT_RESPONSE, noContext: true } };
    return;
  }

  const systemTokens = countTokensApprox(ASK_SYSTEM_TEMPLATE);
  const questionTokens = countTokensApprox(input.question);
  const historyContext = summarizeHistory(history, 3);
  const historyTokens = countTokensApprox(historyContext);

  const availableBudget = getAvailableContextBudget(context.tokenBudget);
  const contextBudget = availableBudget - systemTokens - questionTokens - historyTokens - 500;

  const prunedChunks = pruneChunksByTokenBudget(rawChunks, Math.max(contextBudget, 1000));
  const codeContext = formatCodeContext(prunedChunks);

  const userContent = historyContext
    ? `${codeContext}\n\n${buildAskPrompt(input.question, historyContext)}`
    : `${codeContext}\n\n${buildAskPrompt(input.question)}`;

  const messages: BaseMessage[] = [
    new SystemMessage(ASK_SYSTEM_TEMPLATE),
    new HumanMessage(userContent),
  ];

  yield { type: "status", message: "Generating answer..." };

  let fullResponse = "";

  try {
    const stream = await context.model.stream(messages, {
      signal: input.abortSignal,
    });

    for await (const chunk of stream) {
      if (input.abortSignal?.aborted) {
        throw new CliRuntimeError("Request canceled");
      }
      const chunkContent = chunk.content;
      const content = typeof chunkContent === "string" ? chunkContent : "";
      if (content) {
        fullResponse += content;
        yield { type: "token", content };
      }
    }
  } catch (err) {
    throw new CliRuntimeError("Failed to generate response", err);
  }

  yield { type: "complete", result: { answer: fullResponse } };
}
