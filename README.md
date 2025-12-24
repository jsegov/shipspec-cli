<p align="center">
  <img src="assets/ship-spec-logo.png" alt="Ship Spec Logo" width="600">
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
  <a href="#-contributing">Contributing</a> •
  <a href="SECURITY.md">Security</a>
</p>

> [!WARNING]
> **Under Construction**: This CLI tool is currently in active development and is **not yet fully functional**. Some features may be missing, broken, or change significantly without notice.

---

## Why Ship Spec?

Understanding a codebase's production readiness is hard. Manual security and reliability audits are tedious. **Ship Spec** bridges the gap by using AI to analyze your code semantically and generate comprehensive production reports on demand.

```bash
# Initialize project and set API keys
ship-spec init

# Analyze production readiness
ship-spec productionalize "B2B SaaS handling PII, targeting SOC 2"
```

That's it. Ship Spec handles the rest—parsing your code into semantic chunks, automatically building a searchable vector index, and orchestrating AI agents to evaluate your project against industry standards.

---

## ✨ Features

- **🔍 Semantic Code Understanding** — Uses Tree-sitter for AST-based parsing across TypeScript, JavaScript, Python, Go, and Rust
- **🧠 Agentic Workflow** — LangGraph.js orchestrates a Map-Reduce pattern with planning, parallel analysis, and synthesis
- **🛡️ Production Readiness Analysis** — Hybrid planner combines deterministic signals with dynamic research and SAST scans
- **🗄️ Local-First Vector Store** — Embedded LanceDB for fast similarity search without external dependencies
- **☁️ Multi-Provider Support** — Works with OpenAI, Anthropic, Ollama (local), Google Vertex AI, Mistral, and Azure OpenAI
- **🔐 Secure Credential Management** — Stores API keys in your OS keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service)
- **⚡ High Performance** — Concurrent file processing with configurable parallelism and batching

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+** required
- An API key from OpenAI and Tavily (optional but recommended for web research)

### 1. Install

```bash
npm install -g shipspec-cli
```

### 2. Initialize and configure API keys

```bash
cd your-project
ship-spec init
```

The `init` command will:
- Prompt you for your OpenAI and Tavily API keys
- Store them securely in your OS keychain (one-time setup per machine)
- Create a `.ship-spec/` directory in your project for tracking state and outputs

### 3. Analyze production readiness

```bash
ship-spec productionalize
```

The tool will:
- Automatically index your codebase on the first run
- Run parallel analysis agents
- Save the results to `.ship-spec/outputs/`

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
# Recommendation: use npm ci for deterministic installs
npm ci
npm run build
npm link
```

---

## 📖 Usage

### `ship-spec init`

Initialize Ship Spec in the current directory and configure global API keys.

```bash
# Interactive setup
ship-spec init

# Non-interactive setup (for CI/CD)
OPENAI_API_KEY=sk-... TAVILY_API_KEY=tvly-... ship-spec init --non-interactive
```

### `ship-spec productionalize [context]`

Analyze your codebase for production readiness. This command automatically indexes your codebase, then combines code analysis, web research (SOC 2, OWASP), and SAST scans.

```bash
# Basic usage
ship-spec productionalize

# With specific context
ship-spec productionalize "B2B SaaS handling PII, targeting SOC 2"

# Force full re-indexing
ship-spec productionalize --reindex

# Enable SAST scans (Semgrep, Gitleaks, Trivy)
ship-spec productionalize --enable-scans
```

**Outputs:**
Analysis reports and task prompts are automatically saved to:
- `.ship-spec/outputs/report-YYYYMMDD-HHMMSS.md`
- `.ship-spec/outputs/task-prompts-YYYYMMDD-HHMMSS.md`
- Latest results are always available at `.ship-spec/latest-report.md` and `.ship-spec/latest-task-prompts.md`.

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--reindex` | Force full re-index of the codebase | `false` |
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

### Configuration Precedence

Ship Spec resolves configuration in the following order (highest priority first):

1. **CLI Flags**: Explicitly passed arguments when running a command.
2. **Environment Variables**: `OPENAI_API_KEY`, `OLLAMA_BASE_URL`, etc.
3. **Configuration File**: `ship-spec.json` (or `.ship-spec.json`) in the project root.
4. **Default Values**: Built-in defaults as defined in the schema.

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Development Setup

```bash
git clone https://github.com/your-org/shipspec-cli.git
cd shipspec-cli
npm ci
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
- [keytar](https://github.com/atom/node-keytar) — OS keychain integration

---

<p align="center">
  Made with ❤️ by the Ship Spec community
</p>
