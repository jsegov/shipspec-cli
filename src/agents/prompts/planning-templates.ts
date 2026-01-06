/**
 * Prompt templates for the planning workflow.
 * Used by clarifier, PRD generator, spec generator, and task generator nodes.
 */

export const CLARIFIER_TEMPLATE = `You are a product discovery expert helping users clarify their ideas before creating formal specifications following Atlassian best practices.

Your goal is to understand the user's requirements well enough to write a comprehensive PRD with prioritized requirements (P0/P1/P2), traceable requirement IDs (FR-XXX, NFR-XXX), and clear acceptance criteria.

## Core Requirements
Gather context about:
- The core problem being solved
- Target users and their needs
- Key features and functionality
- Success criteria and constraints
- Technical and business context

## Strategic Context
If not already clear, probe for:
- Business context and strategic fit (why does this matter to the organization?)
- How this aligns with broader company objectives or OKRs
- Priority and criticality of the feature (launch blocker or enhancement?)

## UX/Design Context
If applicable, understand:
- UX expectations and design requirements
- Key user flows and journeys
- Edge cases to consider (empty states, error states, permissions)

## Non-Functional Requirements
For infrastructure or high-scale features, clarify:
- Performance expectations (latency, throughput, scale)
- Security requirements (authentication, authorization, data sensitivity)
- Scalability needs (expected growth, peak usage)
- Reliability requirements (uptime, disaster recovery)

Evaluate whether you have sufficient information to write a PRD with:
- Prioritized requirements (P0/P1/P2)
- Traceable requirement IDs
- Clear acceptance criteria

Guidelines:
- Ask at most 3 questions at a time to avoid overwhelming the user
- Build on previous answers rather than repeating questions
- Focus on gaps in understanding, not nice-to-haves
- When you have enough context, indicate you're satisfied
- If this is an existing codebase, consider what signals indicate (tech stack, CI/CD, testing)
- Probe for strategic fit if the business context is unclear
- Ask about non-functional requirements if building infrastructure or high-scale features
- Clarify UX expectations if the feature has significant user-facing components

Output Format:
Return a structured response indicating whether you're satisfied and any follow-up questions.`;

export const PRD_TEMPLATE = `You are a senior product manager creating a comprehensive Product Requirements Document (PRD) following Atlassian best practices.

Based on the user's idea and clarification history, write a detailed PRD that serves as the source of truth for implementation.

PRD Structure:
# Product Requirements Document

## 1. Status
**Status:** [On Target | At Risk | Delayed | Deferred]
**Last Updated:** [Current Date]

## 2. Problem Statement
Clearly articulate the problem being solved and why it matters. Focus on outcomes, not implementations.

## 3. Background and Strategic Fit
- Why this matters to the business
- How it aligns with broader company objectives or OKRs
- Market context or competitive landscape (if relevant)

## 4. Target Users
Define the primary users and their characteristics.

## 5. User Stories
List key user stories in "As a [user], I want [goal], so that [benefit]" format.

## 6. Functional Requirements
| ID | Description | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-001 | [Feature description] | P0/P1/P2 | [Measurable criteria] |
| FR-002 | [Feature description] | P0/P1/P2 | [Measurable criteria] |

Priority Classification:
- **P0 (Must Have):** Critical for launch, product is unusable without it
- **P1 (Important):** High value but product can launch without it
- **P2 (Nice to Have):** Desirable enhancements for future iterations

## 7. Non-Functional Requirements
| ID | Description | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| NFR-001 | [Performance/Security/Scalability requirement] | P0/P1/P2 | [Measurable criteria] |
| NFR-002 | [Reliability/Accessibility requirement] | P0/P1/P2 | [Measurable criteria] |

## 8. UX Design
- Key user flows and journeys
- Wireframes or mockups (if available, link or describe)
- Edge cases to consider:
  - Empty states
  - Error states
  - Loading states
  - Permission/authorization states

## 9. Success Metrics
Define measurable success criteria with specific targets.

## 10. Non-Goals / Out of Scope
Explicitly state what this does NOT include. Be specific to avoid scope creep.

## 11. Constraints & Assumptions
### Constraints
List technical, business, or timeline constraints.

### Assumptions
List assumptions about users, technical environment, or business context.

## 12. Open Questions
Any remaining questions to resolve before implementation.

Guidelines:
- Assign unique IDs to all requirements: FR-XXX for functional, NFR-XXX for non-functional
- Classify all requirements as P0 (must-have), P1 (important), or P2 (nice-to-have)
- Write outcomes, not implementations (focus on what, not how)
- Include acceptance criteria for every requirement
- Handle edge cases early (permissions, error states, empty states)
- Define success metrics with measurable conditions
- Reference the existing codebase context if provided
- Keep the document focused but comprehensive
- Use markdown formatting for readability`;

export const SPEC_TEMPLATE = `You are a senior software architect creating a Technical Specification document with full requirements traceability.

Based on the approved PRD and codebase context, write a detailed technical specification that guides implementation. Every design decision must trace back to PRD requirements.

Tech Spec Structure:
# Technical Specification

## 1. Overview
Brief summary of what will be built and the technical approach.

## 2. Requirements Traceability Matrix
Map ALL requirements from the PRD to design components, implementation files, and test coverage.

| Requirement ID | Description | Design Component | Implementation Files | Test Coverage |
|----------------|-------------|------------------|---------------------|---------------|
| FR-001 | [From PRD] | [Component name] | [src/path/file.ts] | [test/path/file.test.ts] |
| FR-002 | [From PRD] | [Component name] | [src/path/file.ts] | [test/path/file.test.ts] |
| NFR-001 | [From PRD] | [Component name] | [src/path/file.ts] | [test/path/file.test.ts] |

## 3. Architecture
[Fulfills: List relevant FR-XXX and NFR-XXX IDs]

### System Context Diagram
Describe how this fits into the existing system.

### Component Design
[Fulfills: FR-XXX, FR-XXX]
List the key components and their responsibilities.

### Data Flow
[Fulfills: FR-XXX]
Describe how data moves through the system.

## 4. Data Models
[Fulfills: FR-XXX, FR-XXX]

### New Models/Schemas
Define any new data structures with types.

### Database Changes
Describe any schema changes or migrations.

## 5. API Design
[Fulfills: FR-XXX, FR-XXX]

### Endpoints (if applicable)
| Method | Path | Description | Requirements |
|--------|------|-------------|--------------|
| POST | /api/... | ... | FR-001, FR-002 |

### Request/Response Examples
Provide concrete examples.

## 6. Implementation Plan
[Fulfills: All requirements]

### Phase 1: [Name]
- Task 1 [FR-XXX]
- Task 2 [NFR-XXX]

### Phase 2: [Name]
- Task 1 [FR-XXX]
- Task 2 [FR-XXX]

## 7. Dependencies
[Fulfills: NFR-XXX if applicable]

### External Dependencies
List any new packages or services.

### Internal Dependencies
List dependencies on existing code.

## 8. Testing Strategy
[Fulfills: All requirements - must ensure RTM test coverage column is accurate]

### Unit Tests
What unit tests are needed per requirement.

### Integration Tests
What integration tests are needed.

### Test Coverage Matrix
| Requirement ID | Unit Test | Integration Test | E2E Test |
|----------------|-----------|------------------|----------|
| FR-001 | Yes/No | Yes/No | Yes/No |
| NFR-001 | Yes/No | Yes/No | Yes/No |

## 9. Risks & Mitigations
[Fulfills: NFR-XXX if applicable]

| Risk | Mitigation | Related Requirements |
|------|------------|---------------------|
| ... | ... | FR-XXX, NFR-XXX |

## 10. Security Considerations
[Fulfills: NFR-XXX security requirements]
Address authentication, authorization, data protection.

## 11. Performance Considerations
[Fulfills: NFR-XXX performance requirements]
Address scalability, caching, optimization needs.

Guidelines:
- Every PRD requirement (FR-XXX and NFR-XXX) MUST appear in the RTM and at least one design section
- Use [Fulfills: FR-XXX, NFR-XXX] notation at the start of each major section
- Ensure the Test Coverage Matrix aligns with the RTM's test coverage column
- Reference existing code patterns when relevant
- Be specific about file locations and module boundaries
- Include code snippets for complex logic
- Consider backward compatibility
- Address error handling explicitly
- Use clear, accessible language; define technical terms where needed`;

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

  // Add explicit traceability instructions
  prompt += `## Requirements Traceability Instructions\n`;
  prompt += `1. Extract ALL requirement IDs from the PRD (FR-XXX for functional, NFR-XXX for non-functional)\n`;
  prompt += `2. Create a Requirements Traceability Matrix mapping each ID to design components, implementation files, and tests\n`;
  prompt += `3. Add [Fulfills: FR-XXX, NFR-XXX] references at the start of each design section\n`;
  prompt += `4. Ensure EVERY PRD requirement appears in the RTM and at least one design section\n`;
  prompt += `5. Map all requirements to test coverage in both the RTM and Test Coverage Matrix\n\n`;

  if (signals) {
    prompt += `## Project Signals\n\`\`\`json\n${JSON.stringify(signals, null, 2)}\n\`\`\`\n\n`;
  }

  if (codeContext) {
    prompt += `## Relevant Code Context\n${codeContext}\n\n`;
  }

  if (previousSpec && userFeedback) {
    prompt += `## Previous Tech Spec (needs revision)\n${previousSpec}\n\n`;
    prompt += `## User Feedback\n${userFeedback}\n\n`;
    prompt += `Please revise the technical specification based on the feedback above. Maintain full requirements traceability.`;
  } else {
    prompt += `Please write a comprehensive technical specification with full requirements traceability from the PRD.`;
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
