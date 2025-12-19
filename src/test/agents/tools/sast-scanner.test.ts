import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSASTScannerTool } from "../../../agents/tools/sast-scanner.js";
import { exec } from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

describe("SAST Scanner Tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return findings from Semgrep", async () => {
    const mockSemgrepOutput = JSON.stringify({
      results: [{
        check_id: "test-rule",
        path: "src/app.ts",
        start: { line: 10 },
        end: { line: 11 },
        extra: { severity: "ERROR", message: "security risk" }
      }]
    });

    (exec as unknown as any).mockImplementation((cmd: string, callback: any) => {
      if (cmd.includes("--version")) callback(null, { stdout: "1.0.0" });
      else if (cmd.includes("semgrep scan")) callback(null, { stdout: mockSemgrepOutput });
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].tool).toBe("semgrep");
    expect(result.findings[0].severity).toBe("high");
  });

  it("should handle missing tools gracefully", async () => {
    (exec as unknown as any).mockImplementation((_cmd: string, callback: any) => {
      callback(new Error("command not found"));
    });

    const tool = createSASTScannerTool({ enabled: true, tools: ["semgrep"] });
    const resultString = await tool.invoke({ tools: ["semgrep"] });
    const result = JSON.parse(resultString);

    expect(result.findings).toHaveLength(0);
    expect(result.skipped[0]).toContain("semgrep failed");
  });
});
