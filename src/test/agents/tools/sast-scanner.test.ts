import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSASTScannerTool } from "../../../agents/tools/sast-scanner.js";
import { execFileWithLimits, ToolMissingError, TimeoutError } from "../../../core/exec.js";

// Mock exec utility
vi.mock("../../../core/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../core/exec.js")>();
  return {
    ...actual,
    execFileWithLimits: vi.fn(),
  };
});

interface ScannerResult {
  findings: {
    tool: string;
    severity: string;
    rule: string;
    message: string;
    diagnostics?: {
      stdout?: string;
      stderr?: string;
      stdoutPreview?: string;
      stderrPreview?: string;
      exitCode?: number;
      truncated?: boolean;
    };
  }[];
  skipped: string[];
}

describe("SAST Scanner Tool", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return findings from Semgrep", async () => {
    const mockSemgrepOutput = JSON.stringify({
      results: [
        {
          check_id: "test-rule",
          path: "src/app.ts",
          start: { line: 10 },
          end: { line: 11 },
          extra: { severity: "ERROR", message: "security risk" },
        },
      ],
    });

    vi.mocked(execFileWithLimits).mockImplementation((file: string, args: string[]) => {
      if (args.includes("--version"))
        return Promise.resolve({ stdout: "1.0.0", stderr: "", exitCode: 0 });
      if (file === "semgrep" && args.includes("scan"))
        return Promise.resolve({ stdout: mockSemgrepOutput, stderr: "", exitCode: 0 });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(1);
    const firstFinding = result.findings[0];
    expect(firstFinding?.tool).toBe("semgrep");
    expect(firstFinding?.severity).toBe("high");
    expect(firstFinding?.rule).toBe("test-rule");

    expect(execFileWithLimits).toHaveBeenCalledWith("semgrep", ["scan", "--json", "--quiet"]);
  });

  it("should omit diagnostics by default on failure", async () => {
    vi.mocked(execFileWithLimits).mockImplementation((file: string, args: string[]) => {
      if (args.includes("--version"))
        return Promise.resolve({ stdout: "1.0.0", stderr: "", exitCode: 0 });
      if (file === "semgrep" && args.includes("scan"))
        return Promise.resolve({ stdout: "not json", stderr: "some error", exitCode: 0 });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(1);
    const firstFinding = result.findings[0];
    expect(firstFinding?.rule).toBe("scanner_error");
    expect(firstFinding?.diagnostics).toBeUndefined();
  });

  it("should include sanitized diagnostics when SHIPSPEC_DEBUG_DIAGNOSTICS=1", async () => {
    process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";

    const secret = "sk-1234567890123456789012345678";
    const ansiError = `\x1b[31mError with secret ${secret}\x1b[0m`;

    vi.mocked(execFileWithLimits).mockImplementation((file: string, args: string[]) => {
      if (args.includes("--version"))
        return Promise.resolve({ stdout: "1.0.0", stderr: "", exitCode: 0 });
      if (file === "semgrep" && args.includes("scan"))
        return Promise.resolve({ stdout: "not json", stderr: ansiError, exitCode: 0 });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(1);
    const firstFinding = result.findings[0];
    expect(firstFinding?.diagnostics).toBeDefined();
    expect(firstFinding?.diagnostics?.stdoutPreview).toBe("not json");
    expect(firstFinding?.diagnostics?.stderrPreview).toBe("Error with secret [REDACTED]");
    expect(firstFinding?.diagnostics?.stderrPreview).not.toContain("\x1b[");
    // truncated should be false since output is under the 4096 character limit
    expect(firstFinding?.diagnostics?.truncated).toBe(false);
  });

  it("should truncate long diagnostics", async () => {
    process.env.SHIPSPEC_DEBUG_DIAGNOSTICS = "1";
    // Use realistic error message that won't match secret patterns
    const longOutput = "Error: File not found. ".repeat(210); // ~5000 chars

    vi.mocked(execFileWithLimits).mockImplementation((file: string, args: string[]) => {
      if (args.includes("--version"))
        return Promise.resolve({ stdout: "1.0.0", stderr: "", exitCode: 0 });
      if (file === "semgrep" && args.includes("scan"))
        return Promise.resolve({ stdout: longOutput, stderr: "", exitCode: 0 });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const toolResult = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(toolResult) as ScannerResult;

    const diag = result.findings[0]?.diagnostics;
    // The output should be truncated to 4096 chars + "... [truncated]"
    expect(diag?.stdoutPreview).toHaveLength(4096 + "... [truncated]".length);
    expect(diag?.stdoutPreview).toContain("[truncated]");
    // truncated should be true since original was > 4096 chars
    expect(diag?.truncated).toBe(true);
  });

  it("should handle missing tools gracefully", async () => {
    vi.mocked(execFileWithLimits).mockImplementation((file: string) => {
      throw new ToolMissingError(file);
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(0);
    const firstSkipped = result.skipped[0];
    expect(firstSkipped).toContain("semgrep failed");
  });

  it("should fail if --version check times out", async () => {
    vi.mocked(execFileWithLimits).mockImplementation((_file: string, args: string[]) => {
      if (args.includes("--version")) {
        throw new TimeoutError("semgrep", 5);
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(0);
    const firstSkipped = result.skipped[0];
    expect(firstSkipped).toContain("semgrep failed");
    expect(firstSkipped).toContain("timed out");
    expect(firstSkipped).toContain("misconfigured or unresponsive");
  });

  it("should return scanner_error findings for Gitleaks malformed output", async () => {
    vi.mocked(execFileWithLimits).mockImplementation((file: string, args: string[]) => {
      if (args.includes("version"))
        return Promise.resolve({ stdout: "8.0.0", stderr: "", exitCode: 0 });
      if (file === "gitleaks" && args.includes("detect"))
        return Promise.resolve({ stdout: "{ invalid json }", stderr: "", exitCode: 0 });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["gitleaks"] });
    const resultString = await tool.invoke({ tools: ["gitleaks"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.tool).toBe("gitleaks");
    expect(result.findings[0]?.rule).toBe("scanner_error");
  });

  it("should return scanner_error findings for Trivy malformed output", async () => {
    vi.mocked(execFileWithLimits).mockImplementation((file: string, args: string[]) => {
      if (args.includes("--version"))
        return Promise.resolve({ stdout: "0.45.0", stderr: "", exitCode: 0 });
      if (file === "trivy" && args.includes("fs"))
        return Promise.resolve({ stdout: "[ malformed }", stderr: "", exitCode: 0 });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["trivy"] });
    const resultString = await tool.invoke({ tools: ["trivy"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.tool).toBe("trivy");
    expect(result.findings[0]?.rule).toBe("scanner_error");
  });

  it("should return scanner_timeout findings for tool timeout", async () => {
    vi.mocked(execFileWithLimits).mockImplementation((file: string, args: string[]) => {
      if (args.includes("--version") || args.includes("version"))
        return Promise.resolve({ stdout: "1.0.0", stderr: "", exitCode: 0 });
      throw new TimeoutError(file, 300);
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("scanner_timeout");
  });
});
