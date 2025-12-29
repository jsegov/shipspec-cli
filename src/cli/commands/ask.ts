/**
 * Ask Command
 * Interactive codebase Q&A with RAG-powered context retrieval and streaming responses.
 */

import { Command } from "commander";
import { readFile } from "fs/promises";
import { resolve, join } from "path";
import { existsSync } from "fs";
import chalk from "chalk";
import { input } from "@inquirer/prompts";
import { z } from "zod";

import { loadConfig, type ShipSpecSecrets } from "../../config/loader.js";
import type { ShipSpecConfig } from "../../config/schema.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { createEmbeddingsModel } from "../../core/models/embeddings.js";
import { createChatModel } from "../../core/models/llm.js";
import { ensureIndex } from "../../core/indexing/ensure-index.js";
import { logger, sanitizeError } from "../../utils/logger.js";
import { CliUsageError, CliRuntimeError } from "../errors.js";
import { findProjectRoot, PROJECT_DIR } from "../../core/project/project-state.js";
import { createSecretsStore } from "../../core/secrets/secrets-store.js";
import {
  pruneChunksByTokenBudget,
  countTokensApprox,
  getAvailableContextBudget,
  type TokenBudget,
} from "../../utils/tokens.js";
import {
  ASK_SYSTEM_TEMPLATE,
  NO_CONTEXT_RESPONSE,
  formatCodeContext,
  buildAskPrompt,
  summarizeHistory,
  type ConversationEntry,
} from "../../agents/prompts/ask-templates.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/** REPL commands */
const REPL_COMMANDS = {
  EXIT: ["/exit", "/quit"],
  CLEAR: ["/clear"],
  HELP: ["/help"],
};

/** Consent schema for cloud LLM data sharing */
const ConsentSchema = z
  .object({
    cloudOk: z.literal(true),
    timestamp: z.string().optional(),
    version: z.number().int().optional(),
  })
  .strict();

/** Commander options shape */
interface CommanderAskOptions {
  reindex?: boolean;
  cloudOk?: boolean;
  localOnly?: boolean;
}

/** Parsed and validated options */
interface AskOptions {
  reindex: boolean;
  cloudOk: boolean;
  localOnly: boolean;
}

/**
 * Main ask action handler.
 */
async function askAction(
  question: string | undefined,
  cmdOpts: CommanderAskOptions
): Promise<void> {
  const options: AskOptions = {
    reindex: cmdOpts.reindex ?? false,
    cloudOk: cmdOpts.cloudOk ?? false,
    localOnly: cmdOpts.localOnly ?? false,
  };

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

  // 6. Initialize repository for RAG
  const repository = await initializeRepository(config, resolvedSecrets, options.reindex);
  if (!repository) {
    throw new CliUsageError(
      "No codebase index found. Run `ship-spec init` to index your codebase."
    );
  }

  // 7. Create chat model
  const model = await createChatModel(config.llm, resolvedSecrets.llmApiKey);

  // 8. Calculate token budget
  const tokenBudget: TokenBudget = {
    maxContextTokens: config.llm.maxContextTokens,
    reservedOutputTokens: config.llm.reservedOutputTokens,
  };

  // 9. Run in single-question or REPL mode
  if (question?.trim()) {
    // Single question mode - answer and exit
    await handleQuestion(question.trim(), model, repository, tokenBudget, []);
  } else {
    // Enter interactive REPL mode
    await runRepl(model, repository, tokenBudget);
  }
}

/**
 * Initializes the document repository with index freshness check.
 */
async function initializeRepository(
  config: ShipSpecConfig,
  secrets: ShipSpecSecrets,
  forceReindex: boolean
): Promise<DocumentRepository | null> {
  try {
    logger.progress("Initializing vector store...");
    const vectorStore = new LanceDBManager(resolve(config.vectorDbPath));

    // Resolve embedding dimensions
    let resolvedDimensions: number;
    if (config.embedding.dimensions === "auto") {
      const probeEmbeddings = await createEmbeddingsModel(
        config.embedding,
        secrets.embeddingApiKey
      );
      const probeVector = await probeEmbeddings.embedQuery("dimension probe");
      resolvedDimensions = probeVector.length;
    } else {
      resolvedDimensions = config.embedding.dimensions;
    }

    const resolvedEmbeddingConfig = { ...config.embedding, dimensions: resolvedDimensions };
    const resolvedConfig = { ...config, embedding: resolvedEmbeddingConfig };

    const embeddings = await createEmbeddingsModel(config.embedding, secrets.embeddingApiKey);
    const repository = new DocumentRepository(vectorStore, embeddings, resolvedDimensions);

    // Ensure index is fresh
    const manifestPath = join(config.vectorDbPath, "index-manifest");
    logger.progress("Checking codebase index freshness...");
    const indexResult = await ensureIndex({
      config: resolvedConfig,
      repository,
      vectorStore,
      manifestPath,
      forceReindex,
    });

    if (indexResult.added > 0 || indexResult.modified > 0 || indexResult.removed > 0) {
      logger.info(
        `Index updated: ${String(indexResult.added)} added, ${String(indexResult.modified)} modified, ${String(indexResult.removed)} removed.`
      );
    } else {
      logger.info("Index is up to date.");
    }

    return repository;
  } catch (err) {
    logger.warn(`Failed to initialize code search: ${sanitizeError(err)}`);
    return null;
  }
}

/**
 * Checks and handles cloud LLM consent.
 */
async function checkCloudConsent(
  config: ShipSpecConfig,
  options: AskOptions,
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
    logger.warn("This command will send data to cloud-based LLM providers.");
    logger.warn("Providers involved:");
    if (isCloudLLM) logger.warn(`- LLM: ${config.llm.provider}`);
    if (isCloudEmbedding) logger.warn(`- Embedding: ${config.embedding.provider}`);
    logger.plain("");
    logger.plain("To proceed, you must explicitly acknowledge this data sharing:");
    logger.plain(chalk.cyan(`  ship-spec ask --cloud-ok`));
    logger.plain("");
    throw new CliUsageError("Data sharing consent required.");
  }
}

/**
 * Handles a single question with RAG retrieval and streaming response.
 */
async function handleQuestion(
  question: string,
  model: BaseChatModel,
  repository: DocumentRepository,
  tokenBudget: TokenBudget,
  history: ConversationEntry[]
): Promise<string> {
  // 1. Retrieve relevant code chunks
  logger.progress("Searching codebase...");
  const rawChunks = await repository.hybridSearch(question, 10);

  if (rawChunks.length === 0) {
    logger.plain("\n" + NO_CONTEXT_RESPONSE + "\n");
    return NO_CONTEXT_RESPONSE;
  }

  // 2. Calculate available token budget for context
  const systemTokens = countTokensApprox(ASK_SYSTEM_TEMPLATE);
  const questionTokens = countTokensApprox(question);
  const historyContext = summarizeHistory(history, 3);
  const historyTokens = countTokensApprox(historyContext);

  const availableBudget = getAvailableContextBudget(tokenBudget);
  // Reserve tokens for: system prompt, question, history, and 500 token buffer
  const contextBudget = availableBudget - systemTokens - questionTokens - historyTokens - 500;

  // 3. Prune chunks to fit budget
  const prunedChunks = pruneChunksByTokenBudget(rawChunks, Math.max(contextBudget, 1000));
  const codeContext = formatCodeContext(prunedChunks);

  // 4. Build messages
  const userContent = historyContext
    ? `${codeContext}\n\n${buildAskPrompt(question, historyContext)}`
    : `${codeContext}\n\n${buildAskPrompt(question)}`;

  const messages: BaseMessage[] = [
    new SystemMessage(ASK_SYSTEM_TEMPLATE),
    new HumanMessage(userContent),
  ];

  // 5. Stream response
  logger.progress("Generating answer...\n");
  let fullResponse = "";

  try {
    const stream = await model.stream(messages);

    for await (const chunk of stream) {
      // Extract text content from streaming chunk
      const chunkContent = chunk.content;
      const content = typeof chunkContent === "string" ? chunkContent : "";
      process.stdout.write(content);
      fullResponse += content;
    }

    // Ensure newline at end
    process.stdout.write("\n\n");
  } catch (err) {
    throw new CliRuntimeError("Failed to generate response", err);
  }

  return fullResponse;
}

/**
 * Runs the interactive REPL loop.
 */
async function runRepl(
  model: BaseChatModel,
  repository: DocumentRepository,
  tokenBudget: TokenBudget
): Promise<void> {
  const history: ConversationEntry[] = [];

  logger.plain(chalk.bold("\nCodebase Q&A Mode"));
  logger.plain(chalk.dim("Ask questions about your codebase. Type /help for commands.\n"));

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    let userInput: string;

    try {
      userInput = await input({
        message: chalk.cyan("ask>"),
      });
    } catch (err) {
      // Handle Ctrl+C / Ctrl+D gracefully
      if (
        err instanceof Error &&
        (err.message.includes("User force closed") || err.name === "ExitPromptError")
      ) {
        logger.plain("\nGoodbye!");
        break;
      }
      throw err;
    }

    const trimmedInput = userInput.trim();

    // Handle empty input
    if (!trimmedInput) {
      continue;
    }

    // Handle REPL commands
    if (trimmedInput.startsWith("/")) {
      const shouldExit = handleReplCommand(trimmedInput, history);
      if (shouldExit) {
        break;
      }
      continue;
    }

    // Handle question
    try {
      const answer = await handleQuestion(trimmedInput, model, repository, tokenBudget, history);

      // Add to history for follow-up context
      history.push({
        question: trimmedInput,
        answer,
      });
    } catch (err) {
      if (err instanceof CliRuntimeError) {
        logger.error(err.toPublicString());
      } else {
        logger.error(sanitizeError(err));
      }
      // Continue REPL loop - don't exit on error
    }
  }
}

/**
 * Handles REPL commands.
 *
 * @returns true if the REPL should exit
 */
function handleReplCommand(command: string, history: ConversationEntry[]): boolean {
  const lowerCommand = command.toLowerCase();

  if (REPL_COMMANDS.EXIT.includes(lowerCommand)) {
    logger.plain("Goodbye!");
    return true;
  }

  if (REPL_COMMANDS.CLEAR.includes(lowerCommand)) {
    history.length = 0;
    logger.info("Conversation history cleared.");
    return false;
  }

  if (REPL_COMMANDS.HELP.includes(lowerCommand)) {
    logger.plain(chalk.bold("\nAvailable Commands:"));
    logger.plain("  /help   - Show this help message");
    logger.plain("  /clear  - Clear conversation history");
    logger.plain("  /exit   - Exit the session (or /quit)");
    logger.plain("");
    return false;
  }

  logger.warn(`Unknown command: ${command}. Type /help for available commands.`);
  return false;
}

export const askCommand = new Command("ask")
  .description("Ask questions about your codebase using AI-powered search")
  .argument("[question]", "Question to ask (enters interactive mode if omitted)")
  .option("--reindex", "Force re-index before asking")
  .option("--cloud-ok", "Consent to sending data to cloud LLM providers")
  .option("--local-only", "Strictly refuse to use cloud-based providers")
  .action(askAction);
