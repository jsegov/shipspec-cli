import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import type { SASTConfig } from "../../config/schema.js";

const execAsync = promisify(exec);

export interface SASTFinding {
  tool: "semgrep" | "gitleaks" | "trivy";
  severity: "critical" | "high" | "medium" | "low" | "info";
  rule: string;
  message: string;
  filepath: string;
  startLine?: number;
  endLine?: number;
  cweId?: string;
  cveId?: string;
  diagnostics?: {
    stderr?: string;
    stdout?: string;
    exitCode?: number;
  };
}

export const SASTFindingSchema = z.object({
  tool: z.enum(["semgrep", "gitleaks", "trivy"]),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  rule: z.string(),
  message: z.string(),
  filepath: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  cweId: z.string().optional(),
  cveId: z.string().optional(),
  diagnostics: z
    .object({
      stderr: z.string().optional(),
      stdout: z.string().optional(),
      exitCode: z.number().optional(),
    })
    .optional(),
});

export const ScannerResultsSchema = z.object({
  findings: z.array(SASTFindingSchema).optional(),
  skipped: z.array(z.string()).optional(),
});

const SemgrepResultSchema = z.object({
  check_id: z.string(),
  path: z.string(),
  start: z.object({ line: z.number() }).optional(),
  end: z.object({ line: z.number() }).optional(),
  extra: z
    .object({
      severity: z.string().optional(),
      message: z.string().optional(),
      metadata: z
        .object({
          cwe: z.union([z.string(), z.array(z.string())]).optional(),
        })
        .optional(),
    })
    .optional(),
});

const SemgrepOutputSchema = z.object({
  results: z.array(SemgrepResultSchema).optional(),
});

const GitleaksResultSchema = z.object({
  RuleID: z.string(),
  Description: z.string(),
  File: z.string(),
  StartLine: z.number(),
  EndLine: z.number(),
});

const GitleaksOutputSchema = z.array(GitleaksResultSchema);

const TrivyVulnerabilitySchema = z.object({
  Severity: z.string(),
  VulnerabilityID: z.string(),
  Title: z.string().optional(),
  Description: z.string().optional(),
});

const TrivySecretSchema = z.object({
  Severity: z.string(),
  RuleID: z.string(),
  Title: z.string(),
  StartLine: z.number(),
  EndLine: z.number(),
});

const TrivyResultSchema = z.object({
  Target: z.string(),
  Vulnerabilities: z.array(TrivyVulnerabilitySchema).optional(),
  Secrets: z.array(TrivySecretSchema).optional(),
});

const TrivyOutputSchema = z.object({
  Results: z.array(TrivyResultSchema).optional(),
});

export function createSASTScannerTool(config?: SASTConfig) {
  return new DynamicStructuredTool({
    name: "run_sast_scans",
    description:
      "Run configured SAST scanners (Semgrep, Gitleaks, Trivy) and return normalized findings",
    schema: z.object({
      tools: z
        .array(z.enum(["semgrep", "gitleaks", "trivy"]))
        .optional()
        .describe("Specific tools to run. If not provided, runs all enabled tools from config."),
    }),
    func: async ({ tools: requestedTools }) => {
      const toolsToRun = requestedTools ?? config?.tools ?? [];
      if (toolsToRun.length === 0) {
        return JSON.stringify({
          findings: [],
          skipped: ["No SAST tools configured or requested."],
        });
      }

      const allFindings: SASTFinding[] = [];
      const skipMessages: string[] = [];

      for (const tool of toolsToRun) {
        try {
          switch (tool) {
            case "semgrep":
              allFindings.push(...(await runSemgrep()));
              break;
            case "gitleaks":
              allFindings.push(...(await runGitleaks()));
              break;
            case "trivy":
              allFindings.push(...(await runTrivy()));
              break;
          }
        } catch (error) {
          skipMessages.push(
            `${tool} failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      return JSON.stringify({
        findings: allFindings,
        skipped: skipMessages,
      });
    },
  });
}

async function checkToolInstalled(command: string, installInstructions: string): Promise<void> {
  try {
    await execAsync(command);
  } catch {
    const toolName = command.split(" ")[0] ?? "tool";
    throw new Error(`${toolName} not found. ${installInstructions}`);
  }
}

async function runSemgrep(): Promise<SASTFinding[]> {
  await checkToolInstalled("semgrep --version", "Install it: pip install semgrep");

  const parseResults = (stdout: string, stderr?: string): SASTFinding[] => {
    try {
      if (!stdout.trim()) {
        return [];
      }
      const parsed: unknown = JSON.parse(stdout);
      const result = SemgrepOutputSchema.safeParse(parsed);
      if (!result.success) {
        return [
          {
            tool: "semgrep",
            severity: "high",
            rule: "scanner_error",
            message: `Semgrep output schema validation failed: ${result.error.message}`,
            filepath: "(scanner)",
            diagnostics: { stdout, stderr },
          },
        ];
      }

      const data = result.data;
      return (data.results ?? []).map((r) => {
        const cweValue = r.extra?.metadata?.cwe;
        return {
          tool: "semgrep" as const,
          severity: mapSemgrepSeverity(r.extra?.severity ?? ""),
          rule: r.check_id,
          message: r.extra?.message ?? "",
          filepath: r.path,
          startLine: r.start?.line,
          endLine: r.end?.line,
          cweId: Array.isArray(cweValue) ? cweValue[0] : cweValue,
        };
      });
    } catch (parseError) {
      return [
        {
          tool: "semgrep",
          severity: "high",
          rule: "scanner_error",
          message: `Failed to parse Semgrep output: ${
            parseError instanceof Error ? parseError.message : String(parseError)
          }`,
          filepath: "(scanner)",
          diagnostics: { stdout, stderr },
        },
      ];
    }
  };

  try {
    const { stdout, stderr } = await execAsync("semgrep scan --json --quiet");
    return parseResults(stdout, stderr);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "stdout" in error &&
      typeof error.stdout === "string"
    ) {
      return parseResults(error.stdout, (error as { stderr?: string }).stderr);
    }
    throw error;
  }
}

function mapSemgrepSeverity(severity: string): SASTFinding["severity"] {
  const s = severity.toLowerCase();
  if (s === "error") return "high";
  if (s === "warning") return "medium";
  if (s === "info") return "info";
  return "medium";
}

async function runGitleaks(): Promise<SASTFinding[]> {
  await checkToolInstalled("gitleaks version", "Install it: https://github.com/gitleaks/gitleaks");

  const parseResults = (stdout: string, stderr?: string): SASTFinding[] => {
    try {
      const trimmedStdout = stdout.trim();
      if (!trimmedStdout || trimmedStdout === "[]" || trimmedStdout === "null") {
        return [];
      }
      const parsed: unknown = JSON.parse(trimmedStdout);
      const result = GitleaksOutputSchema.safeParse(parsed);
      if (!result.success) {
        return [
          {
            tool: "gitleaks",
            severity: "high",
            rule: "scanner_error",
            message: `Gitleaks output schema validation failed: ${result.error.message}`,
            filepath: "(scanner)",
            diagnostics: { stdout, stderr },
          },
        ];
      }

      return result.data.map((r) => ({
        tool: "gitleaks" as const,
        severity: "high" as const,
        rule: r.RuleID,
        message: r.Description,
        filepath: r.File,
        startLine: r.StartLine,
        endLine: r.EndLine,
      }));
    } catch (parseError) {
      return [
        {
          tool: "gitleaks",
          severity: "high",
          rule: "scanner_error",
          message: `Failed to parse Gitleaks output: ${
            parseError instanceof Error ? parseError.message : String(parseError)
          }`,
          filepath: "(scanner)",
          diagnostics: { stdout, stderr },
        },
      ];
    }
  };

  try {
    const { stdout, stderr } = await execAsync(
      "gitleaks detect --no-git --report-format json --report-path -"
    );
    return parseResults(stdout, stderr);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "stdout" in error &&
      typeof error.stdout === "string"
    ) {
      return parseResults(error.stdout, (error as { stderr?: string }).stderr);
    }
    if (error && typeof error === "object" && "code" in error && error.code === 1) return [];
    throw error;
  }
}

async function runTrivy(): Promise<SASTFinding[]> {
  await checkToolInstalled("trivy --version", "Install it: https://trivy.dev/");

  const parseResults = (stdout: string, stderr?: string): SASTFinding[] => {
    try {
      if (!stdout.trim()) {
        return [];
      }
      const parsed: unknown = JSON.parse(stdout);
      const result = TrivyOutputSchema.safeParse(parsed);
      if (!result.success) {
        return [
          {
            tool: "trivy",
            severity: "high",
            rule: "scanner_error",
            message: `Trivy output schema validation failed: ${result.error.message}`,
            filepath: "(scanner)",
            diagnostics: { stdout, stderr },
          },
        ];
      }

      const findings: SASTFinding[] = [];
      const data = result.data;

      for (const trivyResult of data.Results ?? []) {
        for (const vuln of trivyResult.Vulnerabilities ?? []) {
          findings.push({
            tool: "trivy",
            severity: mapTrivySeverity(vuln.Severity),
            rule: vuln.VulnerabilityID,
            message: vuln.Title ?? vuln.Description ?? "",
            filepath: trivyResult.Target,
            cveId: vuln.VulnerabilityID,
          });
        }
        for (const secret of trivyResult.Secrets ?? []) {
          findings.push({
            tool: "trivy",
            severity: mapTrivySeverity(secret.Severity),
            rule: secret.RuleID,
            message: secret.Title,
            filepath: trivyResult.Target,
            startLine: secret.StartLine,
            endLine: secret.EndLine,
          });
        }
      }
      return findings;
    } catch (parseError) {
      return [
        {
          tool: "trivy",
          severity: "high",
          rule: "scanner_error",
          message: `Failed to parse Trivy output: ${
            parseError instanceof Error ? parseError.message : String(parseError)
          }`,
          filepath: "(scanner)",
          diagnostics: { stdout, stderr },
        },
      ];
    }
  };

  try {
    const { stdout, stderr } = await execAsync("trivy fs . --format json --quiet");
    return parseResults(stdout, stderr);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "stdout" in error &&
      typeof error.stdout === "string"
    ) {
      return parseResults(error.stdout, (error as { stderr?: string }).stderr);
    }
    throw error;
  }
}

function mapTrivySeverity(severity: string): SASTFinding["severity"] {
  const s = severity.toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  if (s === "low") return "low";
  return "info";
}
