/**
 * Context Gatherer Node
 * Gathers project signals and RAG context automatically when index exists.
 */

import { gatherProjectSignals } from "../../../core/analysis/project-signals.js";
import type { DocumentRepository } from "../../../core/storage/repository.js";
import type { ShipSpecConfig } from "../../../config/schema.js";
import type { PlanningStateType } from "../state.js";
import { logger } from "../../../utils/logger.js";

/**
 * Creates the context gatherer node.
 * Collects project signals and relevant code context via RAG.
 *
 * @param config - The ShipSpec configuration
 * @param repository - Optional DocumentRepository for RAG (null if no index)
 */
export function createContextGathererNode(
  config: ShipSpecConfig,
  repository: DocumentRepository | null
) {
  return async (state: PlanningStateType): Promise<Partial<PlanningStateType>> => {
    logger.progress("Gathering project context...");

    // Gather project signals (tech stack, CI/CD, tests, etc.)
    let signals = null;
    try {
      signals = await gatherProjectSignals(config.projectPath);
      const ciInfo = signals.hasCI ? `CI (${signals.ciPlatform ?? "unknown"})` : "no CI";
      logger.info(
        `Detected: ${signals.detectedLanguages.join(", ") || "no languages"}, ` +
          `${signals.packageManager ?? "no package manager"}, ` +
          ciInfo
      );
    } catch {
      logger.warn("Failed to gather project signals, continuing without them.");
    }

    // Gather relevant code context via RAG if repository available
    let codeContext = "";
    if (repository && state.initialIdea) {
      try {
        logger.progress("Searching codebase for relevant context...");
        const chunks = await repository.hybridSearch(state.initialIdea, 15);

        if (chunks.length > 0) {
          codeContext = chunks
            .map(
              (c) =>
                `### ${c.filepath}:${String(c.startLine)}-${String(c.endLine)}\n` +
                `\`\`\`${c.language}\n${c.content}\n\`\`\``
            )
            .join("\n\n");
          logger.info(`Found ${String(chunks.length)} relevant code chunks.`);
        } else {
          logger.info("No relevant code context found.");
        }
      } catch {
        logger.warn("Failed to search codebase, continuing without code context.");
      }
    } else if (!repository) {
      logger.info("No index available, skipping code context search.");
    }

    return { signals, codeContext };
  };
}
