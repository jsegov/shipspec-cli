<p align="center">
  <h1 align="center">🚀 Ship Spec</h1>
  <p align="center">
    <strong>AI-powered codebase analysis and technical specification generation</strong>
  </p>
  <p align="center">
    Turn your codebase into actionable technical documentation with one command.
  </p>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-usage">Usage</a> •
  <a href="#-configuration">Configuration</a> •
  <a href="#-contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node Version">
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

## Why Ship Spec?

Understanding a codebase is hard. Writing documentation is tedious. **Ship Spec** bridges the gap by using AI to analyze your code semantically and generate comprehensive technical specifications on demand.

```bash
# Index your codebase
ship-spec ingest

# Ask anything about your code
ship-spec spec "How does authentication work in this codebase?"
```

That's it. Ship Spec handles the rest—parsing your code into semantic chunks, building a searchable vector index, and orchestrating AI agents to deliver accurate, contextual answers.

---

## ✨ Features

- **🔍 Semantic Code Understanding** — Uses Tree-sitter for AST-based parsing across TypeScript, JavaScript, Python, Go, and Rust
- **🧠 Agentic Workflow** — LangGraph.js orchestrates a Map-Reduce pattern with planning, parallel analysis, and synthesis
- **🗄️ Local-First Vector Store** — Embedded LanceDB for fast similarity search without external dependencies
- **☁️ Multi-Provider Support** — Works with OpenAI, Anthropic, Ollama (local), Google Vertex AI, Mistral, and Azure OpenAI
- **📊 Streaming Progress** — Real-time visibility into analysis progress with colored terminal output
- **⚡ High Performance** — Concurrent file processing with configurable parallelism and batching

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+** required
- An API key from OpenAI, Anthropic, or a running [Ollama](https://ollama.ai) instance

### 1. Install

```bash
npm install -g shipspec-cli
```

### 2. Set up your API key

```bash
# Create a .env file in your project
echo "OPENAI_API_KEY=sk-your-key-here" > .env

# Or for Anthropic
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" > .env

# Or for local Ollama (no key needed)
echo "OLLAMA_BASE_URL=http://localhost:11434" > .env
```

### 3. Index your codebase

```bash
cd your-project
ship-spec ingest
```

### 4. Generate a specification

```bash
ship-spec spec "Explain the data flow from API request to database"
```

---

## 📦 Installation

### Global Installation (Recommended)

```bash
npm install -g shipspec-cli
```

### Local Installation

```bash
npm install shipspec-cli
npx ship-spec --help
```

### From Source

```bash
git clone https://github.com/your-org/shipspec-cli.git
cd shipspec-cli
npm install
npm run build
npm link
```

---

## 📖 Usage

### `ship-spec ingest`

Index your codebase into the vector store. This creates semantic embeddings of your code for intelligent retrieval.

```bash
# Basic usage - index current directory
ship-spec ingest

# With custom concurrency
ship-spec ingest --concurrency 20 --batch-size 100

# Preview what would be indexed
ship-spec ingest --dry-run
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--concurrency <n>` | Parallel file processors | `10` |
| `--batch-size <n>` | Documents per embedding batch | `50` |
| `--dry-run` | Preview files without indexing | `false` |

### `ship-spec spec <prompt>`

Generate technical specifications based on natural language prompts.

```bash
# Basic usage
ship-spec spec "How does authentication work?"

# Save to file
ship-spec spec "Document the API layer" -o api-spec.md

# Disable streaming progress
ship-spec spec "Explain error handling" --no-stream
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<prompt>` | Natural language description of what to analyze |

**Options:**

| Option | Description |
|--------|-------------|
| `-o, --output <file>` | Write output to file instead of stdout |
| `--no-stream` | Disable real-time progress output |

### `ship-spec config`

Display the resolved configuration.

```bash
ship-spec config
```

### Global Options

```bash
ship-spec --help        # Show help
ship-spec --version     # Show version
ship-spec -v, --verbose # Enable verbose logging
ship-spec -c, --config <path>  # Use custom config file
```

---

## ⚙️ Configuration

Ship Spec can be configured via a config file or environment variables.

### Config File

Create a `shipspec.json`, `.shipspecrc`, or `.shipspecrc.json` in your project root:

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
    "temperature": 0
  },
  "embedding": {
    "provider": "openai",
    "modelName": "text-embedding-3-large",
    "dimensions": 3072
  }
}
```

### Environment Variables

API keys are loaded from `.env` or your shell environment:

```bash
# OpenAI (default)
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Ollama (local inference)
OLLAMA_BASE_URL=http://localhost:11434

# Google Vertex AI
GOOGLE_API_KEY=...

# Mistral
MISTRAL_API_KEY=...

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://...
```

### Supported Providers

| Provider | LLM | Embeddings |
|----------|-----|------------|
| OpenAI | ✅ | ✅ |
| Anthropic | ✅ | ❌ |
| Ollama | ✅ | ✅ |
| Google Vertex AI | ✅ | ✅ |
| Mistral | ✅ | ✅ |
| Azure OpenAI | ✅ | ✅ |

### Using Ollama (Local Inference)

For fully local, private analysis:

```bash
# Start Ollama
ollama serve

# Pull required models
ollama pull llama3.2
ollama pull nomic-embed-text
```

Configure Ship Spec:

```json
{
  "llm": {
    "provider": "ollama",
    "modelName": "llama3.2"
  },
  "embedding": {
    "provider": "ollama",
    "modelName": "nomic-embed-text",
    "dimensions": 768
  }
}
```

---

## 🏗️ How It Works

Ship Spec uses a **Retrieval-Augmented Generation (RAG)** architecture with an agentic workflow:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Ingest    │────▶│  Vector DB  │────▶│   Query     │
│  (Parse &   │     │  (LanceDB)  │     │  (Retrieve  │
│   Embed)    │     │             │     │   & RAG)    │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Ingestion Pipeline

1. **Discovery** — Finds source files using fast-glob (respects ignore patterns)
2. **Parsing** — Uses Tree-sitter for semantic chunking (functions, classes, modules)
3. **Embedding** — Generates vector embeddings in configurable batches
4. **Storage** — Stores chunks with metadata in LanceDB

### Analysis Workflow (LangGraph.js)

```
User Query ──▶ Planner ──▶ [Worker 1] ──┐
                          [Worker 2] ───┼──▶ Aggregator ──▶ Specification
                          [Worker N] ──┘
```

1. **Planner** — Decomposes the query into focused subtasks
2. **Workers** — Execute in parallel, retrieving relevant code and summarizing findings
3. **Aggregator** — Synthesizes all results into a comprehensive specification

---

## 🗂️ Supported Languages

Ship Spec uses Tree-sitter for semantic understanding of:

| Language | Extensions | Semantic Features |
|----------|------------|-------------------|
| TypeScript | `.ts`, `.tsx` | Functions, classes, interfaces |
| JavaScript | `.js`, `.jsx`, `.mjs` | Functions, classes |
| Python | `.py` | Functions, classes, docstrings |
| Go | `.go` | Functions, methods, structs |
| Rust | `.rs` | Functions, structs, enums, traits |

Files with unsupported extensions are processed with intelligent text splitting.

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Development Setup

```bash
git clone https://github.com/your-org/shipspec-cli.git
cd shipspec-cli
npm install
npm run build
```

### Commands

```bash
npm run dev          # Watch mode
npm run typecheck    # Type checking
npm run lint         # Linting
npm test             # Run tests
npm run test:watch   # Tests in watch mode
npm run test:coverage # Coverage report
```

### Project Structure

```
src/
├── cli/           # CLI commands (Commander.js)
├── config/        # Configuration schema & loader
├── core/
│   ├── models/    # LLM & embedding factories
│   ├── parsing/   # Tree-sitter chunking
│   └── storage/   # LanceDB repository
├── agents/        # LangGraph.js workflow
│   ├── nodes/     # Planner, Worker, Aggregator
│   └── tools/     # Retriever tool
└── utils/         # Logging, file system helpers
```

### Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built with these amazing open-source projects:

- [LangChain.js](https://js.langchain.com/) — AI application framework
- [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) — Agentic workflow orchestration
- [LanceDB](https://lancedb.com/) — Embedded vector database
- [Tree-sitter](https://tree-sitter.github.io/) — Incremental parsing system
- [Commander.js](https://github.com/tj/commander.js/) — CLI framework

---

<p align="center">
  Made with ❤️ by the Ship Spec community
</p>
