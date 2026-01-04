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

Planning new features and evaluating production readiness are complex tasks that require deep codebase understanding. **Ship Spec** uses AI to streamline both:

- **Spec-Driven Development** — Interactively plan features with AI-generated PRDs, tech specs, and implementation tasks
- **Production Readiness Analysis** — Semantic code analysis, security audits, and compliance evaluation on demand

```bash
# Launch the interactive TUI (Ask mode)
ship-spec

# Configure API keys in headless mode (or use /connect in the TUI)
ship-spec --headless init

# Plan a new feature with guided workflow
ship-spec --headless planning "Add OAuth authentication" --cloud-ok

# Analyze production readiness
ship-spec --headless productionalize "B2B SaaS handling PII, targeting SOC 2" --cloud-ok
```

Ship Spec handles the heavy lifting—parsing your code into semantic chunks, building a searchable vector index, and orchestrating AI agents to either guide feature planning or evaluate your project against industry standards.

---

## ✨ Features

- **📋 Interactive Planning Workflow** — Spec-driven development with AI-guided clarification, PRD generation, tech specs, and task breakdowns
- **Terminal UI + Headless Mode** — OpenTUI-based Ask/Plan experience with slash commands, plus `--headless` for CI/CD workflows
- **🔍 Semantic Code Understanding** — Uses Tree-sitter for AST-based parsing across TypeScript, JavaScript, Python, Go, and Rust
- **☁️ Unified Model Gateway** — Access Gemini, Claude, and GPT models through a single OpenRouter endpoint
- **🧠 Agentic Workflow** — LangGraph.js orchestrates workflows with human-in-the-loop review cycles
- **🛡️ Production Readiness Analysis** — Hybrid planner combines deterministic signals with dynamic research and SAST scans
- **🗄️ Local-First Vector Store** — Embedded LanceDB for fast similarity search without external dependencies
- **🏠 Local Inference Support** — Maintains local-first philosophy with optional Ollama integration
- **🔐 Secure Credential Management** — Stores API keys in your OS keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service)
- **⚡ High Performance** — Concurrent file processing with configurable parallelism and batching

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+** required
- **Bun 1.2+** required for the interactive TUI (optional if you only use `--headless`)
- **OpenRouter API Key**: Required for cloud models. Get one at [openrouter.ai/keys](https://openrouter.ai/keys).
- **Tavily API Key**: Required for web research. Get one at [app.tavily.com](https://app.tavily.com/) (free tier available).

### 1. Install

```bash
npm install -g shipspec-cli
```

### 2. Initialize and configure API keys

```bash
cd your-project

# Headless setup (CI or scripting)
ship-spec --headless init

# Or launch the TUI and run /connect
ship-spec
```

The `init` command will:
- Prompt you for your **OpenRouter** and **Tavily** API keys
- Store them securely in your OS keychain (one-time setup per machine)
- Create a `.ship-spec/` directory in your project for tracking state and outputs

### 3. Plan features or analyze production readiness

**Launch the TUI (Ask mode by default):**
```bash
ship-spec
```

**Run headless commands:**
```bash
ship-spec --headless planning "Add user authentication" --cloud-ok
ship-spec --headless productionalize --cloud-ok
```

The tool will guide you through clarifying questions, generate PRDs and tech specs, run analysis agents, and save results under `.ship-spec/`.

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
cd tui && bun install
npm run build
npm link
```

---

## 📖 Usage

> [!NOTE]
> In a TTY, `ship-spec` launches the TUI. Add `--headless` to run the commands below, or run them in CI where no TTY is available.

### `ship-spec`

Launch the interactive TUI (Ask mode by default; Tab switches to Plan mode).

```bash
ship-spec
```

**Slash commands:**
- `/connect` - Configure API keys
- `/model` - Model selector (`/model list|current|set <alias>`)
- `/production-readiness-review` (alias `/prr`) - Run production readiness
- `/help` - Show commands and keybinds
- `/clear` - Clear conversation history
- `/exit`, `/quit` - Exit the application

**Keybinds:**
- `Tab` - Toggle Ask/Plan mode
- `Ctrl+C` - Cancel current operation or exit
- `Ctrl+L` - Clear screen
- `Up/Down` - History navigation

### `ship-spec ask [question]`

Ask questions about your codebase in headless mode.

```bash
ship-spec --headless ask "How does indexing work?"
ship-spec --headless ask --reindex
```

When no question is provided, the command enters a REPL-style loop.

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--reindex` | Force re-index before asking | `false` |
| `--cloud-ok` | Acknowledge sending data to cloud LLMs | Required for cloud |
| `--local-only` | Use only local models (Ollama) | `false` |

### `ship-spec init`

Initialize Ship Spec in the current directory and configure global API keys.

```bash
# Interactive setup
ship-spec --headless init

# Non-interactive setup (for CI/CD)
OPENROUTER_API_KEY=sk-or-... TAVILY_API_KEY=tvly-... ship-spec --headless init --non-interactive
```

In the TUI, use `/connect` to configure API keys.

### `ship-spec model <subcommand>`

Manage your chat model selection.

```bash
# List available model aliases
ship-spec --headless model list

# Show currently configured model
ship-spec --headless model current

# Set model (gemini-flash, claude-sonnet, or gpt-pro)
ship-spec --headless model set gemini-flash
```

In the TUI, use `/model` for the selector or `/model list|current|set <alias>`.

### `ship-spec planning [idea]`

Guide you through spec-driven development to plan new features or bootstrap new projects. This interactive command uses AI to help clarify requirements, generate a Product Requirements Document (PRD), create a Technical Specification, and produce actionable implementation tasks.

```bash
# Interactive mode - you'll be prompted for your idea
ship-spec --headless planning

# Provide idea upfront
ship-spec --headless planning "Build a user authentication system with email/password"

# Resume an existing planning session
ship-spec --headless planning --track <track-id>

# Force re-indexing of codebase for better context
ship-spec --headless planning --reindex
```

In the TUI, switch to Plan mode with `Tab`.

**Workflow:**

The planning command follows an interactive, iterative workflow:

1. **Clarification** — AI asks follow-up questions to understand your requirements
2. **PRD Generation** — Creates a Product Requirements Document based on clarified needs
3. **PRD Review** — You review and approve or provide feedback for revision
4. **Tech Spec Generation** — Generates a technical specification from the approved PRD
5. **Tech Spec Review** — You review and approve or provide feedback for revision
6. **Task Generation** — Produces implementation task prompts ready for coding agents

**Outputs:**

All planning artifacts are saved to `.ship-spec/planning/<track-id>/`:
- `prd.md` — Product Requirements Document
- `tech-spec.md` — Technical Specification
- `tasks.md` — Implementation task prompts
- `context.md` — Project signals and code context used
- `track.json` — Session metadata for resumption

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--track <id>` | Resume an existing planning session | Creates new |
| `--reindex` | Force full re-index of the codebase | `false` |
| `--no-save` | Don't save artifacts to disk | `false` |
| `--cloud-ok` | Acknowledge sending data to cloud LLMs | Required |
| `--local-only` | Use only local models (Ollama) | `false` |

**Example Session:**

```bash
$ ship-spec --headless planning --cloud-ok
? Describe what you want to build: Add rate limiting to our API

📝 Clarifying questions:
1. What type of rate limiting do you want? (e.g., per-user, per-IP, per-endpoint)
> Per-user, based on API key

2. What are the rate limits? (e.g., requests per minute/hour)
> 1000 requests per hour, 100 per minute

✓ PRD generated. Awaiting review...
PRD written to: .ship-spec/planning/abc123/prd.md
? Review the PRD and reply 'approve' or provide feedback: approve

✓ Tech spec generated. Awaiting review...
Tech Spec written to: .ship-spec/planning/abc123/tech-spec.md
? Review and reply 'approve' or provide feedback: approve

✓ Generated 5 implementation tasks.
All artifacts saved to: .ship-spec/planning/abc123/
```

### `ship-spec productionalize [context]`

Analyze your codebase for production readiness. This command automatically indexes your codebase, then combines code analysis, web research (SOC 2, OWASP), and SAST scans.

```bash
# Basic usage
ship-spec --headless productionalize

# With specific context
ship-spec --headless productionalize "B2B SaaS handling PII, targeting SOC 2"

# Force full re-indexing
ship-spec --headless productionalize --reindex

# Enable SAST scans (Semgrep, Gitleaks, Trivy)
ship-spec --headless productionalize --enable-scans
```

In the TUI, use `/production-readiness-review` (alias `/prr`).

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
ship-spec --headless config
```

### Global Options

```bash
ship-spec --help        # Show help
ship-spec --version     # Show version
ship-spec -v, --verbose # Enable verbose logging
ship-spec -c, --config <path>  # Use custom config file
ship-spec --headless    # Run Commander commands without the TUI
```

### Configuration Precedence

Ship Spec resolves configuration in the following order (highest priority first):

1. **CLI Flags**: Explicitly passed arguments when running a command.
2. **Environment Variables**: `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `OLLAMA_BASE_URL`, etc.
3. **Configuration File**: `shipspec.json` (or `.shipspec.json`) in the project root.
4. **Default Values**: Built-in defaults as defined in the schema.

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Development Setup

```bash
git clone https://github.com/your-org/shipspec-cli.git
cd shipspec-cli
npm ci
cd tui && bun install
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
cd tui && bun run dev # TUI dev mode
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
- OpenTUI — Terminal UI renderer
- [SolidJS](https://www.solidjs.com/) — UI component framework
- [Bun](https://bun.sh/) — TUI runtime and tooling
- [keytar](https://github.com/atom/node-keytar) — OS keychain integration

---

<p align="center">
  Made with ❤️ by the Ship Spec community
</p>
