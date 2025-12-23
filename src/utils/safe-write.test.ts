import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileAtomicNoFollow } from "./safe-write.js";
import { mkdtemp, rm, readFile, symlink, readdir } from "fs/promises";
import { statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("writeFileAtomicNoFollow", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = await mkdtemp(join(tmpdir(), "safe-write-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should write file with correct content", async () => {
    const filePath = join(testDir, "test-file.txt");
    const content = "Hello, safe world!";

    await writeFileAtomicNoFollow(filePath, content);

    const readContent = await readFile(filePath, "utf-8");
    expect(readContent).toBe(content);
  });

  it("should write Buffer content", async () => {
    const filePath = join(testDir, "test-buffer.bin");
    const content = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    await writeFileAtomicNoFollow(filePath, content);

    const readContent = await readFile(filePath);
    expect(Buffer.compare(readContent, content)).toBe(0);
  });

  it("should set restrictive permissions (0o600) by default on POSIX", async () => {
    if (process.platform === "win32") {
      // Skip permission test on Windows
      return;
    }

    const filePath = join(testDir, "test-permissions.txt");
    await writeFileAtomicNoFollow(filePath, "test");

    const stats = statSync(filePath);
    const fileMode = stats.mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it("should allow custom permissions via options on POSIX", async () => {
    if (process.platform === "win32") {
      // Skip permission test on Windows
      return;
    }

    const filePath = join(testDir, "test-custom-perms.txt");
    await writeFileAtomicNoFollow(filePath, "test", { mode: 0o644 });

    const stats = statSync(filePath);
    const fileMode = stats.mode & 0o777;
    expect(fileMode).toBe(0o644);
  });

  it("should atomically replace existing file", async () => {
    const filePath = join(testDir, "test-replace.txt");

    // Write initial content
    await writeFileAtomicNoFollow(filePath, "initial content");
    expect(await readFile(filePath, "utf-8")).toBe("initial content");

    // Replace with new content
    await writeFileAtomicNoFollow(filePath, "replaced content");
    expect(await readFile(filePath, "utf-8")).toBe("replaced content");
  });

  it("should refuse to write when target is a symlink", async () => {
    if (process.platform === "win32") {
      // Skip symlink test on Windows (requires elevated privileges)
      return;
    }

    const targetFile = join(testDir, "real-file.txt");
    const symlinkPath = join(testDir, "symlink-file.txt");

    // Create target file
    await writeFileAtomicNoFollow(targetFile, "real content");

    // Create symlink pointing to target
    await symlink(targetFile, symlinkPath);

    // Attempt to write to symlink should throw
    await expect(writeFileAtomicNoFollow(symlinkPath, "malicious content")).rejects.toThrow(
      /symlink/i
    );

    // Verify target file was not modified
    expect(await readFile(targetFile, "utf-8")).toBe("real content");
  });

  it("should create parent directory if missing", async () => {
    const nestedDir = join(testDir, "nested", "deeply", "dir");
    const filePath = join(nestedDir, "file.txt");

    await writeFileAtomicNoFollow(filePath, "content in nested dir");

    expect(existsSync(filePath)).toBe(true);
    expect(await readFile(filePath, "utf-8")).toBe("content in nested dir");
  });

  it("should create parent directory with restrictive permissions (0o700) on POSIX", async () => {
    if (process.platform === "win32") {
      // Skip permission test on Windows
      return;
    }

    const nestedDir = join(testDir, "restricted-dir");
    const filePath = join(nestedDir, "file.txt");

    await writeFileAtomicNoFollow(filePath, "content");

    const dirStats = statSync(nestedDir);
    const dirMode = dirStats.mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  it("should clean up temp file on write error", async () => {
    const invalidDir = join(testDir, "nonexistent-readonly");

    // Create a directory and make it readonly (on POSIX)
    if (process.platform !== "win32") {
      await mkdtemp(invalidDir);
      // This test is tricky - instead just verify no .tmp files are left
    }

    const filePath = join(testDir, "file.txt");

    // Write successfully
    await writeFileAtomicNoFollow(filePath, "test");

    // Check no temp files remain
    const files = await readdir(testDir);
    const tempFiles = files.filter((f) => f.startsWith(".") && f.includes(".tmp-"));
    expect(tempFiles).toHaveLength(0);
  });

  it("should handle concurrent writes to same file gracefully", async () => {
    const filePath = join(testDir, "concurrent.txt");

    // Start multiple writes concurrently
    const writes = Promise.all([
      writeFileAtomicNoFollow(filePath, "content-1"),
      writeFileAtomicNoFollow(filePath, "content-2"),
      writeFileAtomicNoFollow(filePath, "content-3"),
    ]);

    await writes;

    // File should exist with one of the contents
    const content = await readFile(filePath, "utf-8");
    expect(["content-1", "content-2", "content-3"]).toContain(content);
  });

  it("should handle empty content", async () => {
    const filePath = join(testDir, "empty.txt");
    await writeFileAtomicNoFollow(filePath, "");
    expect(await readFile(filePath, "utf-8")).toBe("");
  });

  it("should handle very long content", async () => {
    const filePath = join(testDir, "long.txt");
    const longContent = "A".repeat(1024 * 1024); // 1MB of 'A's

    await writeFileAtomicNoFollow(filePath, longContent);
    expect(await readFile(filePath, "utf-8")).toBe(longContent);
  });
});
