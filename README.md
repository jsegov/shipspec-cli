<p align="center">
  <img src="assets/ship-spec-logo-16-9.png" alt="Ship Spec Logo" width="600">
  <h1 align="center">Ship Spec</h1>
  <p align="center">
    <strong>AI-powered codebase analysis and production readiness evaluation</strong>
  </p>
  <p align="center">
    Turn your codebase into actionable production reports with one command.
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

Understanding a codebase's production readiness is hard. Manual security and reliability audits are tedious. **Ship Spec** bridges the gap by using AI to analyze your code semantically and generate comprehensive production reports on demand.

```bash
# Index your codebase
ship-spec ingest

# Analyze production readiness
ship-spec productionalize "B2B SaaS handling PII, targeting SOC 2"
```

That's it. Ship Spec handles the rest—parsing your code into semantic chunks, building a searchable vector index, and orchestrating AI agents to evaluate your project against industry standards.

---

## ✨ Features

- **🔍 Semantic Code Understanding** — Uses Tree-sitter for AST-based parsing across TypeScript, JavaScript, Python, Go, and Rust
- **🧠 Agentic Workflow** — LangGraph.js orchestrates a Map-Reduce pattern with planning, parallel analysis, and synthesis
- **🛡️ Production Readiness Analysis** — Hybrid planner combines deterministic signals with dynamic research and SAST scans
- **🗄️ Local-First Vector Store** — Embedded LanceDB for fast similarity search without external dependencies
- **☁️ Multi-Provider Support** — Works with OpenAI, Anthropic, Ollama (local), Google Vertex AI, Mistral, and Azure OpenAI
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

### 4. Analyze production readiness

```bash
ship-spec productionalize
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

### `ship-spec productionalize [context]`

Analyze your codebase for production readiness. This command combines code analysis, web research (SOC 2, OWASP), and SAST scans to generate a comprehensive report and a Taskmaster-compatible task list.

```bash
# Basic usage
ship-spec productionalize

# With specific context
ship-spec productionalize "B2B SaaS handling PII, targeting SOC 2"

# Enable SAST scans (Semgrep, Gitleaks, Trivy)
ship-spec productionalize --enable-scans

# Output report and tasks to files
ship-spec productionalize -o report.md --tasks-output tasks.json
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <file>` | Write report to file | `stdout` |
| `--tasks-output <file>` | Write tasks JSON to file | `stdout` |
| `--enable-scans` | Run SAST scanners (requires binaries) | `false` |
| `--categories <list>` | Filter to specific categories (csv) | `all` |
| `--no-stream` | Disable real-time progress output | `false` |

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
