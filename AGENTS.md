# AGENTS.md

## Project Overview

Ship Spec CLI is an autonomous semantic engine for codebase analysis and production readiness evaluation. It's a Retrieval-Augmented Generation (RAG) system that ingests source code, constructs vector embeddings, and uses LangGraph.js to orchestrate agentic workflows for analyzing technical debt and security.

**Core Philosophy:** Local-First, Cloud-Optional — supports both local inference (Ollama) and cloud providers (OpenAI, Anthropic).

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript | Core language (strict mode, ESM) |
| Commander.js | CLI framework |
| Zod | Schema validation |
| LanceDB | Embedded vector database |
| LangChain.js | AI model abstraction |
| LangGraph.js | Agentic workflow orchestration |
| Apache Arrow | Vector data types |
| Web-Tree-sitter | AST parsing for semantic chunking |
| fast-glob | High-performance file discovery |
| p-limit | Concurrency control |
| chalk | Terminal styling |
| Vitest | Unit testing framework |

## Setup Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run the CLI
npm start
# or
node dist/cli/index.js

# Development mode (watch)
npm run dev
```

## CLI Commands

### `ship-spec productionalize [context]`

Analyze the codebase for production readiness. This command automatically ensures the codebase index is up to date before running analysis, using incremental Git-based staleness detection to avoid unnecessary re-indexing.

```bash
# Basic usage
ship-spec productionalize

# With specific context
ship-spec productionalize "B2B SaaS handling PII, targeting SOC 2"

# Force full re-index
ship-spec productionalize --reindex

# Enable SAST scans
ship-spec productionalize --enable-scans
```

**Options:**
- `-o, --output <file>` - Write report to file instead of stdout
- `--tasks-output <file>` - Write Taskmaster JSON to file
- `--reindex` - Force full re-index of the codebase
- `--enable-scans` - Run SAST scanners (Semgrep, Gitleaks, Trivy)
- `--categories <list>` - Filter to specific categories (csv)
- `--no-stream` - Disable streaming progress output

**Workflow:**
1. **Auto-Index** - Ensures codebase index is fresh using Git-based staleness detection (with mtime+size fallback).
2. **Gather Signals** - Deterministic scan for tech stack, CI, tests, etc.
3. **Researcher** - Web search for compliance standards (SOC 2, OWASP, SRE).
4. **SAST Scans** - Run external scanners if enabled and available.
5. **Planner** - Hybrid planner (core categories + dynamic signals).
6. **Workers** - Parallel analysis with code/web/scan routing.
7. **Aggregator** - Synthesize findings into Markdown report.
8. **Task Generator** - Generate agent-executable Taskmaster JSON.

### `ship-spec config`

Display the resolved configuration.

```bash
ship-spec config
```

### Global Options

```bash
ship-spec --help           # Show help
ship-spec --version        # Show version
ship-spec -v, --verbose    # Enable verbose logging
ship-spec -c, --config <path>  # Path to config file
```

## Development Commands

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Build for production
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Verifying Changes

**Before committing any changes, you MUST run the full verification suite:**

```bash
npm run typecheck && npm run lint && npm run format:check && npm run build && npm test
```

All five commands must pass without errors. This ensures:
- **Type safety** — No TypeScript compilation errors
- **Code quality** — No ESLint warnings or errors (zero-warning policy)
- **Code formatting** — Consistent style according to Prettier
- **Build integrity** — Successful production build
- **Test coverage** — All tests pass

> ⚠️ **Do not consider changes complete until this command passes successfully.**

## Project Structure

```
src/
├── cli/                        # Command definitions
│   ├── index.ts               # CLI entry point (Commander.js)
│   └── commands/
│       ├── config.ts          # Display resolved configuration
│       └── productionalize.ts # Production readiness analysis with auto-indexing
├── config/
│   ├── schema.ts              # Zod schemas for configuration
│   └── loader.ts              # Config file & env var loader
├── core/
│   ├── analysis/              # Deterministic project signals
│   │   └── project-signals.ts
│   ├── checkpoint/
│   │   └── index.ts           # Checkpointer factory (MemorySaver/SQLite)
│   ├── indexing/              # Automatic indexing with staleness detection
│   │   └── ensure-index.ts    # Git-based incremental indexing
│   ├── models/
│   │   ├── embeddings.ts      # Embedding model factory
│   │   └── llm.ts             # Chat model factory
│   ├── parsing/
│   │   ├── index.ts           # Unified chunking entry point
│   │   ├── tree-sitter.ts     # WASM parser loader
│   │   ├── chunker.ts         # Semantic AST-based chunking
│   │   ├── fallback-splitter.ts # Text splitter for unsupported files
│   │   └── language-registry.ts # Language configs & queries
│   ├── storage/
│   │   ├── vector-store.ts    # LanceDB manager
│   │   └── repository.ts      # Document repository
│   └── types/
│       └── index.ts           # Shared TypeScript interfaces
├── agents/
│   ├── productionalize/       # NEW: Production readiness workflow
│   │   ├── graph.ts
│   │   ├── state.ts
│   │   └── nodes/
│   │       ├── aggregator.ts
│   │       ├── planner.ts
│   │       ├── researcher.ts
│   │       ├── task-generator.ts
│   │       └── worker.ts
│   ├── state.ts               # AgentState with Annotation.Root
│   ├── graph.ts               # Map-Reduce workflow with Send API
│   ├── nodes/
│   │   ├── planner.ts         # Query decomposition
│   │   ├── worker.ts          # Retrieval and summarization + context pruning
│   │   └── aggregator.ts      # Specification synthesis + findings truncation
│   └── tools/
│       ├── retriever.ts       # DocumentRepository tool wrapper
│       ├── sast-scanner.ts    # NEW: SAST tool wrapper
│       └── web-search.ts      # NEW: Web search tool (Tavily/DDG)
├── test/
│   ├── fixtures.ts            # Test fixtures (sample code)
│   ├── agents/                # Agent tests (state, nodes, tools, graph)
│   ├── cli/                   # CLI command tests
│   │   ├── commands/          # Unit tests for commands
│   │   └── integration.test.ts # End-to-end workflow tests
│   ├── core/                  # Unit tests (mirrors src/core)
│   │   ├── checkpoint/        # Checkpointer factory tests
│   │   └── indexing/          # Indexing and staleness detection tests
│   └── utils/                 # Utility function tests
│       └── tokens.test.ts     # Token counting/pruning tests
└── utils/
    ├── logger.ts              # Logging utilities with chalk
    ├── fs.ts                  # File system helpers
    └── tokens.ts              # Token counting and context pruning
```

## Code Style

- **TypeScript strict mode** — All code must pass `tsc --noEmit`
- **Strict Typing** — Use of `any` is strictly forbidden. Use of `unknown` should be minimized. Always define specific interfaces or types. Use Zod for validating external data.
- **ESM modules** — Use `.js` extensions in imports (e.g., `./schema.js`)
- **Zod validation** — All external inputs (config files, LLM outputs, tool results) must be validated with `safeParse`.
- **Provider abstraction** — Never import vendor SDKs directly in business logic; use factory functions.
- **No Non-Null Assertions** — Avoid `!` operator. Use optional chaining (`?.`), nullish coalescing (`??`), or type guards instead.
- **Template Literals** — When using non-string values (numbers, booleans) in template literals, wrap them in `String()` to satisfy strict linting.
- **Sanitized Logging** — Always use the `logger` utility (`src/utils/logger.ts`) for CLI output. Never use `console.log` or `console.error` directly; the logger ensures secrets are redacted and errors are sanitized.

### Type Safety & Linting

The project enforces a zero-warning ESLint policy with strict TypeScript rules. Key learnings and requirements:

1.  **Zero `any` Usage**: Never use `any` to bypass type checks. Use generics, unions, or `unknown` with narrowing.
2.  **Robust JSON Parsing**: Always type the result of `JSON.parse` as `unknown` before validating with a Zod schema.
3.  **Modern TypeScript Operators**: Use `??` (nullish coalescing) and `?.` (optional chaining) consistently. Avoid `||` for values that could be valid empty strings or zero.
4.  **Array Syntax**: Use `T[]` instead of `Array<T>` for consistency.
5.  **Sync vs Async**: Remove `async` from functions that do not perform `await` operations.
6.  **Floating Promises**: Always await promises or explicitly mark them as ignored using the `void` operator.
7.  **No Direct Console Usage**: Direct use of `console.log` or `console.error` is prohibited. Use the centralized `logger` to prevent accidental credential leakage and ensure sanitized error reporting.

### Import Conventions

```typescript
// ✅ Correct: Use .js extension for local imports
import { loadConfig } from "../config/loader.js";

// ❌ Incorrect: Missing extension
import { loadConfig } from "../config/loader";
```

### Type Safety

- **Strict Typing** — Use of `any` is strictly forbidden. Avoid `unknown` where possible; instead, define specific interfaces or use Zod to parse and validate external data.

```typescript
import { z } from "zod";

// ✅ Correct: Use Zod to validate external data
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});

type User = z.infer<typeof UserSchema>;

function handleUserResponse(data: unknown) {
  const user = UserSchema.parse(data); // Returns typed User or throws
  console.log(`Hello, ${user.name}`);
}

// ✅ Correct: Use specific interfaces for internal logic
interface ProjectConfig {
  path: string;
  depth: number;
}

function analyzeProject(config: ProjectConfig) {
  // ...
}

// ❌ Incorrect: Using any or unknown without validation
function handleData(data: any) {
  console.log(data.someProperty);
}
```

### Naming Conventions

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions/variables: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE` for true constants, `camelCase` for config objects

## Configuration

The CLI supports multiple configuration sources (in priority order):

1. **Environment variables** — API keys via `.env`
2. **Config files** — `shipspec.json`, `.shipspecrc`, or `.shipspecrc.json`
3. **Zod defaults** — Sensible defaults for all options

### Key Environment Variables

```bash
OPENAI_API_KEY=         # For OpenAI embeddings/LLM
ANTHROPIC_API_KEY=      # For Anthropic LLM
OLLAMA_BASE_URL=        # Default: http://localhost:11434
```

### Config Schema (src/config/schema.ts)

The `ShipSpecConfigSchema` defines:
- `projectPath`: Root path to analyze
- `vectorDbPath`: LanceDB storage location (default: `.ship-spec/lancedb`)
- `ignorePatterns`: Glob patterns to exclude
- `llm`: Provider, model, temperature, retry, and token budget settings
- `embedding`: Provider, model, dimensions, and retry settings
- `checkpoint`: Checkpointing configuration for state persistence

### Example Configuration File

```json
{
  "projectPath": ".",
  "vectorDbPath": ".ship-spec/lancedb",
  "ignorePatterns": [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/*.test.ts"
  ],
  "llm": {
    "provider": "openai",
    "modelName": "gpt-5.2-2025-12-11",
    "temperature": 0,
    "maxRetries": 3,
    "timeout": 60000,
    "maxContextTokens": 16000,
    "reservedOutputTokens": 4000
  },
  "embedding": {
    "provider": "openai",
    "modelName": "text-embedding-3-large",
    "dimensions": 3072,
    "maxRetries": 3
  },
  "checkpoint": {
    "enabled": false,
    "type": "memory",
    "sqlitePath": ".ship-spec/checkpoint.db"
  }
}
```

## Vector Database

LanceDB is used as an embedded, serverless vector store:

- **Schema:** `CodeChunk` interface in `src/core/types/index.ts`
- **Dimensions:** Must match the embedding model (OpenAI: 3072, Ollama nomic-embed-text: 768)
- **Hybrid search:** Full-text search index created on `content` field
- **Auto-migration:** Table is recreated if dimension mismatch detected

### CodeChunk Schema

```typescript
// src/core/types/index.ts
export interface CodeChunk {
  id: string;          // UUID
  content: string;     // Source code
  filepath: string;    // Relative path
  startLine: number;   // 1-indexed start line
  endLine: number;     // 1-indexed end line
  language: string;    // "typescript" | "python" | etc.
  type: string;        // "function" | "class" | "interface" | "module"
  name?: string;       // Symbol name if available
  vector?: number[];   // Embedding (added by repository)
}
```

## Adding New Features

### Adding a New Embedding Provider

1. Update `ModelProviderSchema` in `src/config/schema.ts`
2. Add case to switch statement in `src/core/models/embeddings.ts`
3. Install the corresponding `@langchain/*` package

### Adding a New CLI Command

1. Create `src/cli/commands/<command>.ts`
2. Export a `Command` instance
3. Register in `src/cli/index.ts` via `program.addCommand()`

### Adding a New Language for Tree-sitter Parsing

1. Add the language type to `SupportedLanguage` in `src/core/parsing/language-registry.ts`
2. Add the language config to `LANGUAGE_REGISTRY` with:
   - `extensions`: File extensions (e.g., `[".rb"]`)
   - `wasmName`: Name in `tree-sitter-wasms` package
   - `queries`: Tree-sitter S-expression queries for functions/classes
   - `commentPrefix`: Comment style (`//`, `#`, etc.)
3. Verify WASM binary exists in `tree-sitter-wasms` package
4. Add tests in `src/test/core/parsing/`

### Adding a New Agent Node

1. Create a new node file in `src/agents/nodes/`
2. Export a factory function that accepts required dependencies (e.g., `model`, `tools`)
3. Return an async function that accepts `AgentStateType` and returns a partial state update
4. Register the node in `src/agents/graph.ts` using `.addNode()`
5. Connect it to the graph with `.addEdge()` or `.addConditionalEdges()`
6. Add tests in `src/test/agents/nodes/`

### Modifying the Graph Topology

1. Edit `src/agents/graph.ts`
2. Use `StateGraph` methods:
   - `.addNode(name, nodeFunction)` - Add a node
   - `.addEdge(from, to)` - Add a direct edge
   - `.addConditionalEdges(from, conditionFn)` - Add conditional routing
   - Use `Send` API for parallel fan-out (Map-Reduce pattern)
3. Ensure state reducers handle updates correctly
4. Update tests in `src/test/agents/graph.test.ts`

## Testing

The project uses **Vitest** for unit testing with comprehensive coverage of core modules.

### Test Structure

- **Location:** `src/test/` directory, mirroring the `src/core/` structure
- **Naming:** `<module>.test.ts`
- **Fixtures:** Shared test fixtures in `src/test/fixtures.ts`

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### Current Test Coverage

| Module | Tests |
|--------|-------|
| `agents/state` | Reducer behavior for subtasks/context merging |
| `agents/nodes/planner` | Subtask decomposition with structured output |
| `agents/nodes/worker` | Retrieval and summarization logic |
| `agents/nodes/aggregator` | Final specification synthesis |
| `agents/tools/retriever` | DocumentRepository tool wrapper |
| `agents/graph` | Graph topology and node integration |
| `cli/integration` | End-to-end indexing and query workflow |
| `core/indexing/ensure-index` | Git-based staleness detection, incremental indexing |
| `core/models/embeddings` | Factory function, provider validation |
| `core/models/llm` | Chat model factory with initChatModel |
| `core/parsing/tree-sitter` | WASM loading, parser initialization |
| `core/parsing/chunker` | Semantic chunking, comment coalescing |
| `core/parsing/fallback-splitter` | Text splitting for unsupported files |
| `core/parsing/language-registry` | Extension detection, language configs |
| `core/storage/vector-store` | LanceDB connection, table management |
| `core/storage/repository` | Document CRUD, similarity search |

### Writing Tests

Use type-safe mocking with Vitest. Avoid `any` in tests.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";

interface Message {
  content: string;
}

describe("MyModule", () => {
  let tempDir: string;

  // Helper to extract content from mocked LLM calls
  const getInvokeContent = (mock: unknown): string => {
    const mocked = vi.mocked(mock as { invoke: (messages: Message[]) => unknown });
    const calls = mocked.invoke.mock.calls;
    const firstCall = calls[0];
    if (!firstCall) return "";
    const firstArg = firstCall[0];
    return firstArg[0]?.content ?? "";
  };

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("should do something", () => {
    expect(true).toBe(true);
  });
});
```

### Regression Testing for Bug Fixes

**When fixing a bug, you MUST add a test case that verifies the fix if one does not already exist.**

This ensures:
- The bug doesn't reoccur in future refactoring
- The fix is validated and documented
- Test coverage remains comprehensive

**Process:**
1. Identify the root cause and edge case that triggered the bug
2. Write a test case that reproduces the bug (it should fail before the fix)
3. Apply the fix to make the test pass
4. Verify all existing tests still pass
5. Commit both the fix and the test together

**Example:** If a bug is discovered where incremental indexing doesn't update the embedding signature in the manifest, add a test case like:

```typescript
it("should update manifest with current embedding signature during incremental indexing", async () => {
  // Setup: Create initial index
  await ensureIndex({ config, repository, vectorStore, manifestPath });
  
  // Modify a file to trigger incremental update
  await writeFile(join(projectPath, "test.ts"), "// Modified");
  
  // Run incremental update
  await ensureIndex({ config, repository, vectorStore, manifestPath });
  
  // Verify manifest reflects current config
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  expect(manifest.embeddingSignature).toEqual(config.embedding);
});
```

## Common Patterns

### Factory Pattern for Models

```typescript
// src/core/models/embeddings.ts
export async function createEmbeddingsModel(config: EmbeddingConfig): Promise<Embeddings> {
  switch (config.provider) {
    case "openai":
      return new OpenAIEmbeddings({ ... });
    case "ollama":
      return new OllamaEmbeddings({ ... });
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}
```

### Repository Pattern for Storage

```typescript
// src/core/storage/repository.ts
class DocumentRepository {
  async addDocuments(chunks: CodeChunk[]): Promise<void>
  async similaritySearch(query: string, k: number): Promise<CodeChunk[]>
  async hybridSearch(query: string, k: number): Promise<CodeChunk[]>
  async deleteByFilepath(filepath: string): Promise<void>
}
```

### Semantic Chunking with Tree-sitter

```typescript
// src/core/parsing/index.ts — Unified entry point
import { chunkSourceFile } from "./index.js";

const chunks = await chunkSourceFile(filepath, content, {
  minChunkSize: 50,
  maxChunkSize: 4000,
  includeComments: true,
});
```

### Language Registry Pattern

```typescript
// src/core/parsing/language-registry.ts
export const LANGUAGE_REGISTRY: Record<SupportedLanguage, LanguageConfig> = {
  typescript: {
    extensions: [".ts", ".tsx"],
    wasmName: "typescript",
    queries: {
      functions: "(function_declaration name: (identifier) @name) @func",
      classes: "(class_declaration name: (type_identifier) @name) @class",
      interfaces: "(interface_declaration name: (type_identifier) @name) @interface",
    },
    commentPrefix: "//",
  },
  // ... python, javascript, go, rust
};
```

### Supported Languages

| Language | Extensions | Features |
|----------|------------|----------|
| TypeScript | `.ts`, `.tsx` | Functions, classes, interfaces |
| JavaScript | `.js`, `.jsx`, `.mjs` | Functions, classes |
| Python | `.py` | Functions, classes with docstrings |
| Go | `.go` | Functions, methods, structs |
| Rust | `.rs` | Functions, structs, enums, traits |

Files with unsupported extensions (`.json`, `.yaml`, `.md`, etc.) are processed with the fallback text splitter.

## Agentic Workflow

The system uses a **Map-Reduce pattern** implemented with LangGraph.js to orchestrate intelligent code analysis:

### Workflow Architecture

```mermaid
flowchart LR
    UserQuery[User Query] --> Planner[Planner Node]
    Planner -->|Send API| Worker1[Worker 1]
    Planner -->|Send API| Worker2[Worker 2]
    Planner -->|Send API| WorkerN[Worker N]
    Worker1 --> Aggregator[Aggregator Node]
    Worker2 --> Aggregator
    WorkerN --> Aggregator
    Aggregator --> Result[Final Report]
```

### State Schema

The `AgentState` (defined in `src/agents/state.ts`) manages:

- **`userQuery`**: Original user request
- **`subtasks`**: Dynamically generated subtasks with status tracking
  - Reducer merges updates by subtask ID
- **`messages`**: Conversation history for LLM context
  - Reducer concatenates messages
- **`context`**: Accumulated code chunks from retrievals
  - Reducer appends new chunks
- **`finalSpec`**: Generated technical specification

### Node Responsibilities

1. **Planner Node** (`src/agents/nodes/planner.ts`):
   - Takes user query
   - Uses LLM with structured output (Zod) to decompose into 3-7 focused subtasks
   - Each subtask has an ID and specific query

2. **Worker Node** (`src/agents/nodes/worker.ts`):
   - Receives a single subtask via `Send` API
   - Uses `retrieve_code` tool to find relevant code chunks
   - Summarizes findings for that specific subtask
   - Updates subtask status to "complete" with result

3. **Aggregator Node** (`src/agents/nodes/aggregator.ts`):
   - Collects all completed subtask results
   - Synthesizes findings into a comprehensive markdown specification
   - Sets `finalSpec` in state

### Retriever Tool

The `retrieve_code` tool (`src/agents/tools/retriever.ts`) wraps `DocumentRepository.hybridSearch()` as a LangChain `DynamicStructuredTool`, enabling LLMs to semantically search the codebase during analysis.

## Advanced Features

### Checkpointing

State persistence allows resuming long-running analysis sessions:

```typescript
import { createCheckpointer } from "./core/checkpoint/index.js";

// Create in-memory checkpointer (for development)
const checkpointer = await createCheckpointer("memory");

// Create SQLite-backed checkpointer (for persistence)
const checkpointer = await createCheckpointer("sqlite", ".ship-spec/checkpoint.db");
```

**Configuration:**
```json
{
  "checkpoint": {
    "enabled": true,
    "type": "sqlite",
    "sqlitePath": ".ship-spec/checkpoint.db"
  }
}
```

### Retry Logic

Automatic retries with exponential backoff for resilient API calls:

```json
{
  "llm": {
    "provider": "ollama",
    "modelName": "llama2",
    "maxRetries": 5,
    "timeout": 60000
  },
  "embedding": {
    "provider": "openai",
    "modelName": "text-embedding-3-large",
    "maxRetries": 3
  }
}
```

- `maxRetries`: Number of retry attempts (default: 3, max: 10)
- `timeout`: Request timeout in milliseconds (optional)

### Token Management

Intelligent context pruning prevents LLM context overflow:

```json
{
  "llm": {
    "maxContextTokens": 16000,
    "reservedOutputTokens": 4000
  }
}
```

- `maxContextTokens`: Maximum tokens for input context (default: 16000)
- `reservedOutputTokens`: Tokens reserved for model output (default: 4000)

The worker node automatically prunes retrieved code chunks to fit within the token budget. The aggregator node truncates accumulated findings if they exceed the available context.

## Next Steps

Future enhancements could include:
- Human-in-the-loop workflows with interruption points
- Multi-model routing for specialized tasks
- Custom embedding fine-tuning for domain-specific codebases
- Support for additional SAST scanners and analysis tools

## Troubleshooting

### "Dimension mismatch" warning

The embedding dimensions changed (e.g., switched from OpenAI to Ollama). The system will automatically detect this change and trigger a full re-index on the next `productionalize` run.

### ESM import errors

Ensure all local imports use `.js` extension. TypeScript compiles `.ts` to `.js`, but import paths are not rewritten.

### WASM loading failures

If Tree-sitter fails to parse a file, it will automatically fall back to text splitting. Common causes:

- Missing WASM file: Ensure `tree-sitter-wasms` package is installed
- Syntax errors in source: Malformed code triggers fallback gracefully
- Memory issues: Very large files may exceed WASM limits

Check logs with `--verbose` flag to see which files used fallback parsing.

### API key errors

Ensure your API keys are set in the `.env` file or as environment variables:

```bash
# For OpenAI (default)
export OPENAI_API_KEY=sk-...

# For Anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# For Ollama (local)
export OLLAMA_BASE_URL=http://localhost:11434
```

### Ollama connection refused

If using Ollama, ensure the server is running:

```bash
ollama serve
```
