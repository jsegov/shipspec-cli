import { execFileWithLimits, TimeoutError, ToolMissingError } from "../../core/exec.js";
import { join } from "path";

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

  it("should throw error if binary verification fails", async () => {
    // We can't easily make 'node' fail verification without hacking,
    // but maybe we can use something that exists but isn't a tool?
    // Using a simple file that isn't executable or doesn't support --version.
    const tempFile = join(process.cwd(), "not-a-tool.txt");
    await import("fs/promises").then((fs) => fs.writeFile(tempFile, "not a tool"));
    try {
      await import("fs/promises").then((fs) => fs.chmod(tempFile, 0o755));
      process.env.NOT_A_TOOL_PATH = tempFile;
      const promise = execFileWithLimits("not_a_tool", []);
      await expect(promise).rejects.toThrow(/Binary verification failed/);
    } finally {
      delete process.env.NOT_A_TOOL_PATH;
      await import("fs/promises").then((fs) => fs.rm(tempFile));
    }
  });
});
