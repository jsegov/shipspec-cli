import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ProductionalizeStateType } from "../state.js";
import type { UserAnalysisContext } from "../types.js";
import {
  PRODUCTIONALIZE_PLANNER_TEMPLATE,
  ProductionalizePlanSchema,
} from "../../prompts/index.js";

/**
 * Formats user context into a human-readable string for the planner prompt.
 * Returns empty string if no context is available.
 */
function formatUserContext(userContext: UserAnalysisContext | null): string {
  if (!userContext) return "";

  const sections: string[] = [];

  if (userContext.primaryConcerns.length > 0) {
    sections.push(`Primary Concerns: ${userContext.primaryConcerns.join(", ")}`);
  }

  if (userContext.deploymentTarget) {
    sections.push(`Deployment Target: ${userContext.deploymentTarget}`);
  }

  if (userContext.complianceRequirements.length > 0) {
    sections.push(`Compliance Requirements: ${userContext.complianceRequirements.join(", ")}`);
  }

  if (userContext.priorityCategories.length > 0) {
    sections.push(`Priority Categories: ${userContext.priorityCategories.join(", ")}`);
  }

  if (userContext.additionalContext) {
    sections.push(`Additional Context: ${userContext.additionalContext}`);
  }

  return sections.length > 0 ? sections.join("\n") : "";
}

/**
 * Creates the planner node.
 * Decomposes the user query into focused subtasks for parallel worker execution.
 *
 * Uses userContext (from interview phase) to prioritize subtasks and tailor
 * the analysis to the user's specific concerns and requirements.
 *
 * @param model - The chat model to use
 */
export function createPlannerNode(model: BaseChatModel) {
  const structuredModel = model.withStructuredOutput(ProductionalizePlanSchema);

  return async (state: ProductionalizeStateType) => {
    const { userQuery, signals, researchDigest, sastResults, userContext } = state;

    // Format user context if available (from interview phase)
    const userContextSection = formatUserContext(userContext);
    const userContextPrompt = userContextSection
      ? `\nUser Analysis Preferences:\n${userContextSection}\n`
      : "";

    const userPrompt = `Project Signals:
${JSON.stringify(signals, null, 2)}
${userContextPrompt}
Research Digest:
${researchDigest}

SAST Results Summary:
${String(sastResults.length)} findings detected from ${[...new Set(sastResults.map((r) => r.tool))].join(", ") || "no tools"}.

User Request:
${userQuery || "Perform a full production-readiness analysis of this codebase."}

${userContext ? "IMPORTANT: Prioritize subtasks that address the user's primary concerns and compliance requirements listed above. Tailor the analysis queries to the specified deployment target." : ""}`;

    const plan = await structuredModel.invoke([
      new SystemMessage(PRODUCTIONALIZE_PLANNER_TEMPLATE),
      new HumanMessage(userPrompt),
    ]);

    return {
      subtasks: plan.subtasks.map((t) => ({
        ...t,
        status: "pending" as const,
      })),
    };
  };
}
