# AGENTS.md

## Project Overview

Ship Spec CLI is an autonomous semantic engine for codebase analysis and technical specification generation. It's a Retrieval-Augmented Generation (RAG) system that ingests source code, constructs vector embeddings, and uses LangGraph.js to orchestrate agentic workflows for generating implementation plans and documentation.

**Core Philosophy:** Local-First, Cloud-Optional — supports both local inference (Ollama) and cloud providers (OpenAI, Anthropic).

### Current Implementation Status

- ✅ **Phase 1:** Foundation, Configuration & CLI Scaffolding
- ✅ **Phase 2:** Knowledge Engine (LanceDB & Embeddings)
- ⏳ **Phase 3:** Code Parsing & Analysis (Tree-sitter) — Not yet implemented
- ⏳ **Phase 4:** Agentic Core (LangGraph.js) — Not yet implemented
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
```

## Project Structure

```
src/
├── cli/                    # Command definitions
│   ├── index.ts           # CLI entry point (Commander.js)
│   └── commands/
│       ├── config.ts      # Display resolved configuration
│       ├── ingest.ts      # Index codebase (placeholder)
│       └── spec.ts        # Generate specs (placeholder)
├── config/
│   ├── schema.ts          # Zod schemas for configuration
│   └── loader.ts          # Config file & env var loader
├── core/
│   ├── models/
│   │   └── embeddings.ts  # Embedding model factory
│   ├── storage/
│   │   ├── vector-store.ts # LanceDB manager
│   │   └── repository.ts   # Document repository
│   └── types/
│       └── index.ts       # Shared TypeScript interfaces
└── utils/
    ├── logger.ts          # Logging utilities
    └── fs.ts              # File system helpers (stub)
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

## Adding New Features

### Adding a New Embedding Provider

1. Update `ModelProviderSchema` in `src/config/schema.ts`
2. Add case to switch statement in `src/core/models/embeddings.ts`
3. Install the corresponding `@langchain/*` package

### Adding a New CLI Command

1. Create `src/cli/commands/<command>.ts`
2. Export a `Command` instance
3. Register in `src/cli/index.ts` via `program.addCommand()`

## Testing

> Testing infrastructure not yet implemented. Plan: Vitest for unit tests.

When implemented, test files should follow:
- Location: `src/**/*.test.ts` or `tests/`
- Naming: `<module>.test.ts`

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

## Next Implementation Steps

When continuing development, follow the implementation plan:

1. **Phase 3:** Implement Tree-sitter integration for semantic code chunking
   - `src/core/parsing/tree-sitter.ts` — WASM loader
   - `src/core/parsing/chunker.ts` — AST-based code splitting

2. **Phase 4:** Build LangGraph.js agentic workflow
   - `src/agents/state.ts` — Agent state definition
   - `src/agents/graph.ts` — Map-Reduce workflow with Send API
   - `src/core/models/llm.ts` — Chat model factory

3. **Phase 5:** Wire up CLI commands
   - Complete `ingest` command with file discovery and batch processing
   - Complete `spec` command with graph execution and streaming output

## Troubleshooting

### "Dimension mismatch" warning

The embedding dimensions changed (e.g., switched from OpenAI to Ollama). The table will be automatically recreated, but existing vectors are lost. Re-run `ingest` to rebuild.

### ESM import errors

Ensure all local imports use `.js` extension. TypeScript compiles `.ts` to `.js`, but import paths are not rewritten.

### WASM loading failures (Phase 3)

When implementing Tree-sitter, use explicit file path resolution for `.wasm` files. The standard `Parser.init()` often fails in Node.js CLI environments.
