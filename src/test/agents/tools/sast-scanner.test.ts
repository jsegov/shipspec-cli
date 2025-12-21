import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSASTScannerTool } from "../../../agents/tools/sast-scanner.js";
import { exec, type ExecException } from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

type ExecCallback = (
  error: ExecException | null,
  result: { stdout: string; stderr?: string }
) => void;

interface ScannerResult {
  findings: { tool: string; severity: string }[];
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

    vi.mocked(exec).mockImplementation((cmd: string, callback: unknown) => {
      const cb = callback as ExecCallback;
      if (cmd.includes("--version")) cb(null, { stdout: "1.0.0" });
      else if (cmd.includes("semgrep scan")) cb(null, { stdout: mockSemgrepOutput });
      return {} as ReturnType<typeof exec>;
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(1);
    const firstFinding = result.findings[0];
    expect(firstFinding?.tool).toBe("semgrep");
    expect(firstFinding?.severity).toBe("high");
  });

  it("should handle missing tools gracefully", async () => {
    vi.mocked(exec).mockImplementation((_cmd: string, callback: unknown) => {
      const cb = callback as ExecCallback;
      cb({ name: "Error", message: "command not found" }, { stdout: "" });
      return {} as ReturnType<typeof exec>;
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString) as ScannerResult;

    expect(result.findings).toHaveLength(0);
    const firstSkipped = result.skipped[0];
    expect(firstSkipped).toContain("semgrep failed");
  });
});
