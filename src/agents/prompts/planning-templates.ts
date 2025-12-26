/**
 * Prompt templates for the planning workflow.
 * Used by clarifier, PRD generator, spec generator, and task generator nodes.
 */

export const CLARIFIER_TEMPLATE = `You are a product discovery expert helping users clarify their ideas before creating formal specifications.

Your goal is to understand the user's requirements well enough to write a comprehensive PRD. You need to gather enough context about:
- The core problem being solved
- Target users and their needs  
- Key features and functionality
- Success criteria and constraints
- Technical and business context

Evaluate whether you have sufficient information to write a clear PRD. If not, ask focused follow-up questions.

Guidelines:
- Ask at most 3 questions at a time to avoid overwhelming the user
- Build on previous answers rather than repeating questions
- Focus on gaps in understanding, not nice-to-haves
- When you have enough context, indicate you're satisfied
- If this is an existing codebase, consider what signals indicate (tech stack, CI/CD, testing)

Output Format:
Return a structured response indicating whether you're satisfied and any follow-up questions.`;

export const PRD_TEMPLATE = `You are a senior product manager creating a comprehensive Product Requirements Document (PRD).

Based on the user's idea and clarification history, write a detailed PRD that serves as the source of truth for implementation.

PRD Structure:
# Product Requirements Document

## 1. Problem Statement
Clearly articulate the problem being solved and why it matters.

## 2. Target Users
Define the primary users and their characteristics.

## 3. User Stories
List key user stories in "As a [user], I want [goal], so that [benefit]" format.

## 4. Features & Requirements
### Core Features (Must Have)
- Feature 1: Description
- Feature 2: Description

### Secondary Features (Nice to Have)
- Feature 1: Description

## 5. Success Metrics
Define measurable success criteria.

## 6. Non-Goals / Out of Scope
Explicitly state what this does NOT include.

## 7. Constraints & Assumptions
List technical, business, or timeline constraints.

## 8. Open Questions
Any remaining questions to resolve.

Guidelines:
- Be specific and actionable
- Include acceptance criteria where relevant
- Reference the existing codebase context if provided
- Keep the document focused but comprehensive
- Use markdown formatting for readability`;

export const SPEC_TEMPLATE = `You are a senior software architect creating a Technical Specification document.

Based on the approved PRD and codebase context, write a detailed technical specification that guides implementation.

Tech Spec Structure:
# Technical Specification

## 1. Overview
Brief summary of what will be built and the technical approach.

## 2. Architecture

### System Context Diagram
Describe how this fits into the existing system.

### Component Design
List the key components and their responsibilities.

### Data Flow
Describe how data moves through the system.

## 3. Data Models

### New Models/Schemas
Define any new data structures with types.

### Database Changes
Describe any schema changes or migrations.

## 4. API Design

### Endpoints (if applicable)
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/... | ... |

### Request/Response Examples
Provide concrete examples.

## 5. Implementation Plan

### Phase 1: [Name]
- Task 1
- Task 2

### Phase 2: [Name]
- Task 1
- Task 2

## 6. Dependencies

### External Dependencies
List any new packages or services.

### Internal Dependencies
List dependencies on existing code.

## 7. Testing Strategy

### Unit Tests
What unit tests are needed.

### Integration Tests
What integration tests are needed.

### Manual Testing
Any manual testing requirements.

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| ... | ... |

## 9. Security Considerations
Address authentication, authorization, data protection.

## 10. Performance Considerations
Address scalability, caching, optimization needs.

Guidelines:
- Reference existing code patterns when relevant
- Be specific about file locations and module boundaries
- Include code snippets for complex logic
- Consider backward compatibility
- Address error handling explicitly`;

export const PLANNING_TASK_TEMPLATE = `You are a technical lead creating implementation task prompts for coding agents.

Convert the technical specification into a series of agent-ready task prompts. Each prompt should be self-contained and actionable.

Each prompt must:
1. Start with a clear action verb (Add, Fix, Update, Remove, Implement, Create)
2. Reference specific file paths where relevant
3. Explain the context and WHY this task is needed
4. Include step-by-step implementation guidance
5. Define acceptance criteria and verification steps

Task Organization:
- Order tasks by dependency (foundational tasks first)
- Group related tasks logically
- Include setup/infrastructure tasks before feature tasks
- End with testing and documentation tasks

Format each task as a complete system prompt that a coding agent can follow independently.

Guidelines:
- Be specific about file names and locations
- Include code patterns or examples where helpful
- Reference the tech spec for detailed requirements
- Each task should be completable in one coding session
- Include all context needed to complete the task`;

/**
 * Builds the clarifier prompt with current context.
 */
export function buildClarifierPrompt(
  initialIdea: string,
  clarificationHistory: { question: string; answer: string }[],
  signals: object | null,
  codeContext: string
): string {
  let prompt = `## User's Initial Idea\n${initialIdea}\n\n`;

  if (clarificationHistory.length > 0) {
    prompt += `## Previous Q&A\n`;
    for (const entry of clarificationHistory) {
      prompt += `**Q:** ${entry.question}\n**A:** ${entry.answer}\n\n`;
    }
  }

  if (signals) {
    prompt += `## Project Signals\n\`\`\`json\n${JSON.stringify(signals, null, 2)}\n\`\`\`\n\n`;
  }

  if (codeContext) {
    prompt += `## Relevant Code Context\n${codeContext}\n\n`;
  }

  prompt += `Based on the above, do you have enough information to write a comprehensive PRD? `;
  prompt += `If not, what specific questions would help clarify the requirements?`;

  return prompt;
}

/**
 * Builds the PRD generator prompt with context.
 */
export function buildPRDPrompt(
  initialIdea: string,
  clarificationHistory: { question: string; answer: string }[],
  signals: object | null,
  codeContext: string,
  previousPRD: string,
  userFeedback: string
): string {
  let prompt = `## User's Initial Idea\n${initialIdea}\n\n`;

  if (clarificationHistory.length > 0) {
    prompt += `## Clarification History\n`;
    for (const entry of clarificationHistory) {
      prompt += `**Q:** ${entry.question}\n**A:** ${entry.answer}\n\n`;
    }
  }

  if (signals) {
    prompt += `## Project Signals\n\`\`\`json\n${JSON.stringify(signals, null, 2)}\n\`\`\`\n\n`;
  }

  if (codeContext) {
    prompt += `## Relevant Code Context\n${codeContext}\n\n`;
  }

  if (previousPRD && userFeedback) {
    prompt += `## Previous PRD (needs revision)\n${previousPRD}\n\n`;
    prompt += `## User Feedback\n${userFeedback}\n\n`;
    prompt += `Please revise the PRD based on the feedback above.`;
  } else {
    prompt += `Please write a comprehensive PRD based on the above information.`;
  }

  return prompt;
}

/**
 * Builds the tech spec generator prompt with context.
 */
export function buildSpecPrompt(
  prd: string,
  signals: object | null,
  codeContext: string,
  previousSpec: string,
  userFeedback: string
): string {
  let prompt = `## Approved PRD\n${prd}\n\n`;

  if (signals) {
    prompt += `## Project Signals\n\`\`\`json\n${JSON.stringify(signals, null, 2)}\n\`\`\`\n\n`;
  }

  if (codeContext) {
    prompt += `## Relevant Code Context\n${codeContext}\n\n`;
  }

  if (previousSpec && userFeedback) {
    prompt += `## Previous Tech Spec (needs revision)\n${previousSpec}\n\n`;
    prompt += `## User Feedback\n${userFeedback}\n\n`;
    prompt += `Please revise the technical specification based on the feedback above.`;
  } else {
    prompt += `Please write a comprehensive technical specification based on the PRD and codebase context.`;
  }

  return prompt;
}

/**
 * Builds the task generator prompt.
 */
export function buildTaskPrompt(techSpec: string, signals: object | null): string {
  let prompt = `## Technical Specification\n${techSpec}\n\n`;

  if (signals) {
    prompt += `## Project Signals\n\`\`\`json\n${JSON.stringify(signals, null, 2)}\n\`\`\`\n\n`;
  }

  prompt += `Convert this technical specification into a series of agent-ready task prompts. `;
  prompt += `Order them by dependency and include all necessary context for each task.`;

  return prompt;
}
