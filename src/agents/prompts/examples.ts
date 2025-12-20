export const PLANNER_EXAMPLES = `
Example 1: General Code Analysis
User Query: "How does authentication work?"
Reasoning: The user wants to understand the end-to-end auth flow. I need to look at providers, session management, middleware, and database schemas.
Subtasks:
1. id: "auth-1", query: "What authentication strategies/providers are configured in the codebase?", reasoning: "Identify the entry point for authentication."
2. id: "auth-2", query: "How are user sessions created, validated, and managed?", reasoning: "Understand session lifecycle and security."
3. id: "auth-3", query: "Which middleware or decorators protect API endpoints?", reasoning: "Identify how authorization is enforced."
4. id: "auth-4", query: "What database tables/schemas store user credentials and roles?", reasoning: "Examine the data model for auth."

Example 2: Production Readiness
User Request: "Prepare for production"
Signals: { "detectedLanguages": ["typescript"], "hasDocker": true }
Reasoning: Since this is a TypeScript project with Docker, I must cover core security, testing, and containerization.
Subtasks:
1. id: "sec-001", category: "security", query: "Check for hardcoded secrets and insecure environment variable handling.", source: "code", rationale: "Core security requirement for production."
2. id: "cont-001", category: "infrastructure", query: "Review Dockerfile for best practices and security hardening.", source: "code", rationale: "Docker was detected in project signals."
`;

export const WORKER_EXAMPLES = `
Example: Security Finding
Query: "Check for hardcoded secrets"
Reasoning: I found a plaintext API key in 'config.ts'. This is a high-risk security gap.
Findings:
- id: "find-001", severity: "high", category: "security", title: "Hardcoded API Key", description: "A plaintext API key was found in the configuration file.", complianceRefs: ["SOC 2 CC6.1"], evidence: { codeRefs: [{ filepath: "src/config.ts", lines: "12-12", content: "const API_KEY = 'sk-12345';" }], links: [] }
Summary: Identified a hardcoded secret in config.ts that should be moved to environment variables.
Confidence: high
`;

export const AGGREGATOR_EXAMPLES = `
Example: Synthesis
User Query: "Review authentication"
Findings:
## auth-1: Providers
- Found Passport.js with JWT strategy.
## auth-2: Middleware
- Found 'ensureAuthenticated' middleware used in all routes.

Synthesis:
The project uses a standard Passport.js JWT authentication flow. Authorization is consistently enforced via custom middleware.
`;

