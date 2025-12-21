import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSASTScannerTool } from "../../../agents/tools/sast-scanner.js";
import { execFileWithLimits, ToolMissingError } from "../../../core/exec.js";

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
    diagnostics?: { stdout?: string; stderr?: string; exitCode?: number };
  }[];
  skipped: string[];
}

describe("SAST Scanner Tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("should return scanner_error finding on malformed JSON", async () => {
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
    expect(firstFinding?.message).toContain("Failed to parse Semgrep output");
    expect(firstFinding?.diagnostics?.stdout).toBe("not json");
    expect(firstFinding?.diagnostics?.stderr).toBe("some error");
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
});
