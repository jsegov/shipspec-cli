# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build          # Build TypeScript + TUI (requires Bun)
npm run build:tui      # Build TUI only
npm run dev            # Watch mode for backend development
npm run typecheck      # Type check without emitting
npm run lint           # ESLint check
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier format
npm run format:check   # Prettier check
cd tui && bun install  # Install TUI dependencies
cd tui && bun run dev  # Run the TUI in dev mode
```

## Testing

```bash
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report

# Run single test file
npx vitest run src/test/core/parsing/chunker.test.ts

# Run tests matching pattern
npx vitest run -t "pattern"
```

Tests are in `src/test/` mirroring the source structure. Vitest uses globals (no imports needed for `describe`, `it`, `expect`).

## Architecture Overview

### TUI + Backend RPC

- TUI lives in `tui/` (Bun + OpenTUI + SolidJS)
- Node backend lives in `src/backend/` and serves NDJSON RPC over stdio
- UI-agnostic flows are in `src/flows/` and are reused by RPC handlers
- `src/cli/index.ts` launches the TUI unless `--headless`, no TTY, or help/version is requested

### LangGraph Agent Pipeline

The core analysis workflow (`src/agents/productionalize/`) is a LangGraph.js state machine with Map-Reduce pattern:

```
START → gatherSignals → researcher → scanner → planner → [worker...] → aggregator → promptGenerator → END
```

- **gatherSignals**: Collects project signals (package.json, configs, etc.)
- **researcher**: Web search for compliance/security standards
- **scanner**: Optional SAST scans (Semgrep, Gitleaks, Trivy)
- **planner**: Creates parallel subtasks based on analysis categories
- **worker**: Parallel execution (uses `Send` for fan-out), performs RAG retrieval
- **aggregator**: Combines worker findings into final report
- **promptGenerator**: Creates actionable task prompts

Graph defined in `src/agents/productionalize/graph.ts`, state in `state.ts`.

### Vector Store & RAG

- **LanceDB**: Embedded vector database at `.ship-spec/lancedb/`
- **DocumentRepository** (`src/core/storage/repository.ts`): High-level API for chunk operations
- **LanceDBManager** (`src/core/storage/vector-store.ts`): Low-level table management with Arrow schemas

### Code Parsing

- **Tree-sitter** (`src/core/parsing/tree-sitter.ts`): AST-based parsing via WASM
- **Chunker** (`src/core/parsing/chunker.ts`): Semantic code splitting
- **Language Registry** (`src/core/parsing/language-registry.ts`): Maps file extensions to Tree-sitter grammars
- Supports: TypeScript, JavaScript, Python, Go, Rust

### Incremental Indexing

`src/core/indexing/ensure-index.ts` implements smart re-indexing:
- Uses git diff when available for changed file detection
- Falls back to mtime/size comparison
- Tracks embedding model signature to detect dimension changes
- Manifest stored at `.ship-spec/index-manifest.json`

### LLM Configuration

- Primary provider: **OpenRouter** (unified gateway to Claude, Gemini, GPT)
- Local option: **Ollama**
- Model factory: `src/core/models/llm.ts`
- Embeddings: `src/core/models/embeddings.ts`
- Config schema with validation: `src/config/schema.ts`

### CLI Structure

- Entry: `src/cli/index.ts` handles TUI vs headless routing with `--headless`
- Commands: `src/cli/commands/` (ask, init, model, planning, productionalize, config)
- Backend RPC: `src/backend/server.ts` + `src/backend/handlers/` delegate to flows in `src/flows/`
- Config resolution: `src/cli/config-resolver.ts`
- Secrets stored in OS keychain via keytar

### Configuration Precedence

1. CLI flags (highest priority)
2. Environment variables (`OPENROUTER_API_KEY`, `TAVILY_API_KEY`)
3. Project config file (`shipspec.json` or `.shipspec.json`)
4. Built-in defaults

## Key Patterns

- ESM modules throughout (`.js` extensions in imports required)
- Zod for runtime validation and config schemas
- Strict TypeScript (`noUncheckedIndexedAccess`, `strictNullChecks`)
- No `console.log` - use `logger` from `src/utils/logger.ts`
- Unused vars must be prefixed with `_`
