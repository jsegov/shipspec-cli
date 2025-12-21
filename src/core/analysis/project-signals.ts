import { existsSync } from "fs";
import { join } from "path";
import fg from "fast-glob";

export interface ProjectSignals {
  packageManager: "npm" | "yarn" | "pnpm" | "pip" | "go" | "cargo" | null;
  hasCI: boolean;
  ciPlatform: string | null;
  hasTests: boolean;
  testFramework: string | null;
  hasDocker: boolean;
  hasIaC: boolean;
  iacTool: string | null;
  hasEnvExample: boolean;
  hasSecurityPolicy: boolean;
  detectedLanguages: string[];
  fileCount: number;
}

export async function gatherProjectSignals(projectPath: string): Promise<ProjectSignals> {
  const signals: ProjectSignals = {
    packageManager: null,
    hasCI: false,
    ciPlatform: null,
    hasTests: false,
    testFramework: null,
    hasDocker: false,
    hasIaC: false,
    iacTool: null,
    hasEnvExample: false,
    hasSecurityPolicy: false,
    detectedLanguages: [],
    fileCount: 0,
  };

  // Detect Package Manager
  if (existsSync(join(projectPath, "package-lock.json"))) signals.packageManager = "npm";
  else if (existsSync(join(projectPath, "yarn.lock"))) signals.packageManager = "yarn";
  else if (existsSync(join(projectPath, "pnpm-lock.yaml"))) signals.packageManager = "pnpm";
  else if (
    existsSync(join(projectPath, "requirements.txt")) ||
    existsSync(join(projectPath, "pyproject.toml"))
  )
    signals.packageManager = "pip";
  else if (existsSync(join(projectPath, "go.mod"))) signals.packageManager = "go";
  else if (existsSync(join(projectPath, "Cargo.toml"))) signals.packageManager = "cargo";

  // Detect CI/CD
  if (existsSync(join(projectPath, ".github/workflows"))) {
    signals.hasCI = true;
    signals.ciPlatform = "github";
  } else if (existsSync(join(projectPath, ".gitlab-ci.yml"))) {
    signals.hasCI = true;
    signals.ciPlatform = "gitlab";
  } else if (existsSync(join(projectPath, "Jenkinsfile"))) {
    signals.hasCI = true;
    signals.ciPlatform = "jenkins";
  } else if (existsSync(join(projectPath, ".circleci"))) {
    signals.hasCI = true;
    signals.ciPlatform = "circleci";
  }

  // Detect Tests
  const testFiles = await fg(["**/test/**", "**/*.test.*", "**/*.spec.*"], {
    cwd: projectPath,
    ignore: ["**/node_modules/**"],
    onlyFiles: true,
  });
  if (testFiles.length > 0) {
    signals.hasTests = true;
    if (
      existsSync(join(projectPath, "jest.config.js")) ||
      existsSync(join(projectPath, "jest.config.ts"))
    )
      signals.testFramework = "jest";
    else if (
      existsSync(join(projectPath, "vitest.config.js")) ||
      existsSync(join(projectPath, "vitest.config.ts"))
    )
      signals.testFramework = "vitest";
    else if (
      existsSync(join(projectPath, "pytest.ini")) ||
      existsSync(join(projectPath, "conftest.py"))
    )
      signals.testFramework = "pytest";
  }

  // Detect Docker
  if (
    existsSync(join(projectPath, "Dockerfile")) ||
    existsSync(join(projectPath, "docker-compose.yml"))
  ) {
    signals.hasDocker = true;
  }

  // Detect IaC
  const tfFiles = await fg(["**/*.tf"], { cwd: projectPath, ignore: ["**/node_modules/**"] });
  if (tfFiles.length > 0) {
    signals.hasIaC = true;
    signals.iacTool = "terraform";
  } else if (existsSync(join(projectPath, "serverless.yml"))) {
    signals.hasIaC = true;
    signals.iacTool = "serverless";
  } else if (existsSync(join(projectPath, "cloudformation.yml"))) {
    signals.hasIaC = true;
    signals.iacTool = "cloudformation";
  } else {
    const bicepFiles = await fg(["**/*.bicep"], {
      cwd: projectPath,
      ignore: ["**/node_modules/**"],
    });
    if (bicepFiles.length > 0) {
      signals.hasIaC = true;
      signals.iacTool = "bicep";
    }
  }

  // Detect Security Configs
  if (existsSync(join(projectPath, ".env.example"))) signals.hasEnvExample = true;
  if (existsSync(join(projectPath, "SECURITY.md"))) signals.hasSecurityPolicy = true;

  // Detect Languages (basic)
  const langExts = {
    typescript: [".ts", ".tsx"],
    javascript: [".js", ".jsx"],
    python: [".py"],
    go: [".go"],
    rust: [".rs"],
  };

  const files = await fg(["**/*"], {
    cwd: projectPath,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    onlyFiles: true,
  });
  signals.fileCount = files.length;

  const detectedExts = new Set(
    files.map((f) => {
      const dotIndex = f.lastIndexOf(".");
      return dotIndex !== -1 ? f.slice(dotIndex) : "";
    })
  );

  for (const [lang, exts] of Object.entries(langExts)) {
    if (exts.some((ext) => detectedExts.has(ext))) {
      signals.detectedLanguages.push(lang);
    }
  }

  return signals;
}
