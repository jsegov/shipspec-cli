# AGENTS.md

## Project Overview

Ship Spec CLI is an autonomous semantic engine for codebase analysis and technical specification generation. It's a Retrieval-Augmented Generation (RAG) system that ingests source code, constructs vector embeddings, and uses LangGraph.js to orchestrate agentic workflows for generating implementation plans and documentation.

**Core Philosophy:** Local-First, Cloud-Optional — supports both local inference (Ollama) and cloud providers (OpenAI, Anthropic).

### Current Implementation Status

- ✅ **Phase 1:** Foundation, Configuration & CLI Scaffolding
- ✅ **Phase 2:** Knowledge Engine (LanceDB & Embeddings)
- ✅ **Phase 3:** Code Parsing & Analysis (Tree-sitter)
- ✅ **Phase 4:** Agentic Core (LangGraph.js) — Completed
- ⏳ **Phase 5:** Workflow Integration & CLI Commands — Placeholders only
- ⏳ **Phase 6:** Advanced Features & Optimization — Not yet implemented

See `implementation-plan.md` for the full technical specification.

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

## Project Structure

```
src/
├── cli/                        # Command definitions
│   ├── index.ts               # CLI entry point (Commander.js)
│   └── commands/
│       ├── config.ts          # Display resolved configuration
│       ├── ingest.ts          # Index codebase (placeholder)
│       └── spec.ts            # Generate specs (placeholder)
├── config/
│   ├── schema.ts              # Zod schemas for configuration
│   └── loader.ts              # Config file & env var loader
├── core/
│   ├── models/
│   │   └── embeddings.ts      # Embedding model factory
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
├── test/
│   ├── fixtures.ts            # Test fixtures (sample code)
│   ├── agents/                # Agent tests (state, nodes, tools, graph)
│   └── core/                  # Unit tests (mirrors src/core)
└── utils/
    ├── logger.ts              # Logging utilities
    └── fs.ts                  # File system helpers (stub)
```

## Code Style

- **TypeScript strict mode** — All code must pass `tsc --noEmit`
- **ESM modules** — Use `.js` extensions in imports (e.g., `./schema.js`)
- **Zod validation** — All external inputs (config files, LLM outputs) must be validated
- **Provider abstraction** — Never import vendor SDKs directly in business logic; use factory functions

### Import Conventions

```typescript
// ✅ Correct: Use .js extension for local imports
import { loadConfig } from "../config/loader.js";

// ❌ Incorrect: Missing extension
import { loadConfig } from "../config/loader";
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
- `llm`: Provider, model, temperature settings
- `embedding`: Provider, model, dimensions settings

## Vector Database

LanceDB is used as an embedded, serverless vector store:

- **Schema:** `CodeChunk` interface in `src/core/types/index.ts`
- **Dimensions:** Must match the embedding model (OpenAI: 1536, Ollama nomic-embed-text: 768)
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
| `core/models/embeddings` | Factory function, provider validation |
| `core/models/llm` | Chat model factory with initChatModel |
| `core/parsing/tree-sitter` | WASM loading, parser initialization |
| `core/parsing/chunker` | Semantic chunking, comment coalescing |
| `core/parsing/fallback-splitter` | Text splitting for unsupported files |
| `core/parsing/language-registry` | Extension detection, language configs |
| `core/storage/vector-store` | LanceDB connection, table management |
| `core/storage/repository` | Document CRUD, similarity search |

### Writing Tests

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";

describe("MyModule", () => {
  let tempDir: string;

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
    Aggregator --> FinalSpec[Final Specification]
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

### Invoking the Graph

```typescript
import { createSpecGraph } from "./agents/graph.js";
import { DocumentRepository } from "./core/storage/repository.js";
import { loadConfig } from "./config/loader.js";

const config = await loadConfig();
const repository = new DocumentRepository(/* ... */);
const graph = await createSpecGraph(config, repository);

const result = await graph.invoke({
  userQuery: "How does authentication work in this codebase?",
});

console.log(result.finalSpec); // Generated specification
```

### Retriever Tool

The `retrieve_code` tool (`src/agents/tools/retriever.ts`) wraps `DocumentRepository.hybridSearch()` as a LangChain `DynamicStructuredTool`, enabling LLMs to semantically search the codebase during analysis.

## Next Implementation Steps

When continuing development, follow the implementation plan:

1. **Phase 5:** Wire up CLI commands
   - Complete `ingest` command with file discovery and batch processing
   - Complete `spec` command with graph execution and streaming output
   - Add progress indicators using `cli-progress`

3. **Phase 6:** Advanced features
   - Checkpointing with `MemorySaver`
   - Retry logic for Ollama resilience
   - Token management and context pruning

## Troubleshooting

### "Dimension mismatch" warning

The embedding dimensions changed (e.g., switched from OpenAI to Ollama). The table will be automatically recreated, but existing vectors are lost. Re-run `ingest` to rebuild.

### ESM import errors

Ensure all local imports use `.js` extension. TypeScript compiles `.ts` to `.js`, but import paths are not rewritten.

### WASM loading failures

If Tree-sitter fails to parse a file, it will automatically fall back to text splitting. Common causes:

- Missing WASM file: Ensure `tree-sitter-wasms` package is installed
- Syntax errors in source: Malformed code triggers fallback gracefully
- Memory issues: Very large files may exceed WASM limits

Check logs with `--verbose` flag to see which files used fallback parsing.
