import { execFileWithLimits, TimeoutError, ToolMissingError } from "../../core/exec.js";

describe("execFileWithLimits", () => {
  it("should execute a command successfully", async () => {
    // node -e "console.log('hello')"
    const result = await execFileWithLimits("node", ["-e", "console.log('hello')"]);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("should throw TimeoutError on timeout", async () => {
    // node -e "setTimeout(() => {}, 2000)" with 1s timeout
    const promise = execFileWithLimits("node", ["-e", "setTimeout(() => {}, 2000)"], {
      timeoutSeconds: 1,
    });
    await expect(promise).rejects.toThrow(TimeoutError);
  });

  it("should throw ToolMissingError for non-existent binary", async () => {
    const promise = execFileWithLimits("non-existent-binary-xyz", []);
    await expect(promise).rejects.toThrow(ToolMissingError);
  });

  it("should respect maxBuffer limit", async () => {
    // node -e "console.log('a'.repeat(1024 * 1024))" with small buffer
    const promise = execFileWithLimits("node", ["-e", "console.log('a'.repeat(2000000))"], {
      maxBufferMB: 1, // 1MB
    });
    // This should fail because 2 million chars > 1MB (roughly)
    await expect(promise).rejects.toThrow(/maxBuffer/i);
  });

  it("should resolve binary from PATH overrides", async () => {
    try {
      // Use something we know exists but mock its path
      const nodePath = process.execPath;
      process.env.MY_TOOL_PATH = nodePath;

      const result = await execFileWithLimits("my_tool", ["--version"]);
      expect(result.exitCode).toBe(0);
    } finally {
      delete process.env.MY_TOOL_PATH;
    }
  });

  it("should inherit minimal environment by default", async () => {
    const result = await execFileWithLimits("node", [
      "-e",
      "console.log(process.env.PATH ? 'exists' : 'missing')",
    ]);
    expect(result.stdout.trim()).toBe("exists");
  });

  it("should reject relative paths in environment overrides", async () => {
    try {
      process.env.MY_TOOL_PATH = "./relative/path/to/tool";
      const promise = execFileWithLimits("my_tool", []);
      await expect(promise).rejects.toThrow(/must be an absolute path/);
    } finally {
      delete process.env.MY_TOOL_PATH;
    }
  });
});
