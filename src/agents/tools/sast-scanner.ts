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
}

export function createSASTScannerTool(config?: SASTConfig) {
  return new DynamicStructuredTool({
    name: "run_sast_scans",
    description: "Run configured SAST scanners (Semgrep, Gitleaks, Trivy) and return normalized findings",
    schema: z.object({
      tools: z.array(z.enum(["semgrep", "gitleaks", "trivy"])).optional().describe("Specific tools to run. If not provided, runs all enabled tools from config."),
    }),
    func: async ({ tools: requestedTools }) => {
      const toolsToRun = requestedTools || config?.tools || [];
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
          skipMessages.push(`${tool} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return JSON.stringify({
        findings: allFindings,
        skipped: skipMessages,
      });
    },
  });
}

interface SemgrepResult {
  check_id: string;
  path: string;
  start?: { line: number };
  end?: { line: number };
  extra?: {
    severity: string;
    message?: string;
    metadata?: {
      cwe?: string | string[];
    };
  };
}

async function runSemgrep(): Promise<SASTFinding[]> {
  try {
    await execAsync("semgrep --version");
  } catch {
    throw new Error("Semgrep not found. Install it: pip install semgrep");
  }

  const parseResults = (stdout: string): SASTFinding[] => {
    try {
      const data = JSON.parse(stdout);
      return (data.results || []).map((r: SemgrepResult) => ({
        tool: "semgrep",
        severity: mapSemgrepSeverity(r.extra?.severity || ""),
        rule: r.check_id,
        message: r.extra?.message || "",
        filepath: r.path,
        startLine: r.start?.line,
        endLine: r.end?.line,
        cweId: Array.isArray(r.extra?.metadata?.cwe) ? r.extra.metadata.cwe[0] : r.extra?.metadata?.cwe,
      }));
    } catch {
      return [];
    }
  };

  try {
    const { stdout } = await execAsync("semgrep scan --json --quiet");
    return parseResults(stdout);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string") {
      return parseResults(error.stdout);
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
  try {
    await execAsync("gitleaks version");
  } catch {
    throw new Error("Gitleaks not found. Install it: https://github.com/gitleaks/gitleaks");
  }

  const parseResults = (stdout: string): SASTFinding[] => {
    try {
      const data = JSON.parse(stdout || "[]");
      return data.map((r: { RuleID: string; Description: string; File: string; StartLine: number; EndLine: number }) => ({
        tool: "gitleaks",
        severity: "high",
        rule: r.RuleID,
        message: r.Description,
        filepath: r.File,
        startLine: r.StartLine,
        endLine: r.EndLine,
      }));
    } catch {
      return [];
    }
  };

  try {
    const { stdout } = await execAsync("gitleaks detect --no-git --report-format json --report-path -");
    return parseResults(stdout);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string") {
      return parseResults(error.stdout);
    }
    if (error && typeof error === "object" && "code" in error && error.code === 1) return [];
    throw error;
  }
}

interface TrivyVulnerability {
  Severity: string;
  VulnerabilityID: string;
  Title?: string;
  Description?: string;
}

interface TrivySecret {
  Severity: string;
  RuleID: string;
  Title: string;
  StartLine: number;
  EndLine: number;
}

interface TrivyResult {
  Target: string;
  Vulnerabilities?: TrivyVulnerability[];
  Secrets?: TrivySecret[];
}

async function runTrivy(): Promise<SASTFinding[]> {
  try {
    await execAsync("trivy --version");
  } catch {
    throw new Error("Trivy not found. Install it: https://trivy.dev/");
  }

  const parseResults = (stdout: string): SASTFinding[] => {
    try {
      const data = JSON.parse(stdout);
      const findings: SASTFinding[] = [];

      for (const result of (data.Results || []) as TrivyResult[]) {
        for (const vuln of (result.Vulnerabilities || [])) {
          findings.push({
            tool: "trivy",
            severity: mapTrivySeverity(vuln.Severity),
            rule: vuln.VulnerabilityID,
            message: vuln.Title || vuln.Description || "",
            filepath: result.Target,
            cveId: vuln.VulnerabilityID,
          });
        }
        for (const secret of (result.Secrets || [])) {
          findings.push({
            tool: "trivy",
            severity: mapTrivySeverity(secret.Severity),
            rule: secret.RuleID,
            message: secret.Title || "",
            filepath: result.Target,
            startLine: secret.StartLine,
            endLine: secret.EndLine,
          });
        }
      }
      return findings;
    } catch {
      return [];
    }
  };

  try {
    const { stdout } = await execAsync("trivy fs . --format json --quiet");
    return parseResults(stdout);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string") {
      return parseResults(error.stdout);
    }
    throw error;
  }
}

function mapTrivySeverity(severity: string): SASTFinding["severity"] {
  const s = severity?.toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  if (s === "low") return "low";
  return "info";
}
