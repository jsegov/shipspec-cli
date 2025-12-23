import { describe, it, expect, afterEach } from "vitest";
import { createTempDir, cleanupTempDir } from "./fixtures.js";
import { tmpdir } from "os";
import { resolve, join } from "path";
import { existsSync } from "fs";

describe("fixtures helpers", () => {
  let createdDirs: string[] = [];

  afterEach(async () => {
    for (const dir of createdDirs) {
      try {
        await cleanupTempDir(dir);
      } catch {
        // Ignore errors in cleanup
      }
    }
    createdDirs = [];
  });

  describe("createTempDir", () => {
    it("should create a directory in the system temp root with correct prefix", async () => {
      const dirPath = await createTempDir();
      createdDirs.push(dirPath);

      expect(dirPath).toContain("shipspec-test-");
      expect(dirPath).toContain(resolve(tmpdir()));
      expect(existsSync(dirPath)).toBe(true);
    });
  });

  describe("cleanupTempDir", () => {
    it("should successfully delete a valid temp directory", async () => {
      const dirPath = await createTempDir();
      expect(existsSync(dirPath)).toBe(true);

      await cleanupTempDir(dirPath);
      expect(existsSync(dirPath)).toBe(false);
    });

    it("should throw error for empty path", async () => {
      await expect(cleanupTempDir("")).rejects.toThrow("dirPath must be a non-empty string");
      await expect(cleanupTempDir("   ")).rejects.toThrow("dirPath must be a non-empty string");
    });

    it("should throw error for filesystem root", async () => {
      await expect(cleanupTempDir("/")).rejects.toThrow("Refusing to delete critical directory");
    });

    it("should throw error for repo root (process.cwd())", async () => {
      const repoRoot = process.cwd();
      await expect(cleanupTempDir(repoRoot)).rejects.toThrow(
        "Refusing to delete critical directory"
      );
    });

    it("should throw error for system temp directory itself", async () => {
      const tempRoot = tmpdir();
      await expect(cleanupTempDir(tempRoot)).rejects.toThrow(
        "Refusing to delete the entire system temp directory"
      );
    });

    it("should throw error for path outside system temp directory", async () => {
      // Assuming /tmp is not inside a relative path to something weird,
      // but let's use a path we know is outside.
      // On Mac, /Users is definitely outside /var/folders/...
      const outsidePath = "/Users/segov/some-random-dir";
      await expect(cleanupTempDir(outsidePath)).rejects.toThrow(
        "Path is not within system temp directory"
      );
    });

    it("should throw error for path in temp dir without correct prefix", async () => {
      const wrongPrefixPath = join(tmpdir(), "some-other-prefix-123");
      await expect(cleanupTempDir(wrongPrefixPath)).rejects.toThrow(
        "Path does not have expected prefix 'shipspec-test-'"
      );
    });

    it("should not throw if directory does not exist (force: true)", async () => {
      const nonExistentPath = join(tmpdir(), "shipspec-test-nonexistent");
      await expect(cleanupTempDir(nonExistentPath)).resolves.not.toThrow();
    });
  });
});
