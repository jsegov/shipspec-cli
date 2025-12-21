import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import fg from "fast-glob";

import { createTempDir, cleanupTempDir, TS_FIXTURE } from "../../fixtures.js";
import { readSourceFile, isSourceFile, getRelativePath } from "../../../utils/fs.js";

// Mock dependencies for unit tests
vi.mock("../../../core/storage/vector-store.js", () => ({
  LanceDBManager: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({}),
    getOrCreateTable: vi.fn().mockResolvedValue({
      add: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

vi.mock("../../../core/models/embeddings.js", () => ({
  createEmbeddingsModel: vi.fn().mockResolvedValue({
    embedDocuments: vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => new Array<number>(3072).fill(0.1)))
      ),
    embedQuery: vi.fn().mockResolvedValue(new Array<number>(3072).fill(0.1)),
  }),
}));

describe("Ingest Command Utilities", () => {
  describe("File Discovery", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("discovers source files with fast-glob", async () => {
      // Create test files
      await writeFile(join(tempDir, "test.ts"), TS_FIXTURE);
      await writeFile(join(tempDir, "data.json"), "{}");
      await mkdir(join(tempDir, "src"), { recursive: true });
      await writeFile(join(tempDir, "src", "app.tsx"), "export default function App() {}");

      const files = await fg("**/*", {
        cwd: tempDir,
        ignore: ["**/node_modules/**"],
        onlyFiles: true,
        absolute: true,
        dot: false,
      });

      expect(files.length).toBe(3);
      expect(files.some((f) => f.endsWith("test.ts"))).toBe(true);
      expect(files.some((f) => f.endsWith("data.json"))).toBe(true);
      expect(files.some((f) => f.endsWith("app.tsx"))).toBe(true);
    });

    it("respects ignore patterns", async () => {
      // Create test files including node_modules
      await writeFile(join(tempDir, "index.ts"), "export {}");
      await mkdir(join(tempDir, "node_modules", "package"), { recursive: true });
      await writeFile(join(tempDir, "node_modules", "package", "index.js"), "module.exports = {}");

      const files = await fg("**/*", {
        cwd: tempDir,
        ignore: ["**/node_modules/**"],
        onlyFiles: true,
        absolute: true,
        dot: false,
      });

      expect(files.length).toBe(1);
      expect(files[0]).toContain("index.ts");
    });

    it("handles nested directories", async () => {
      await mkdir(join(tempDir, "src", "components", "ui"), { recursive: true });
      await writeFile(
        join(tempDir, "src", "components", "ui", "Button.tsx"),
        "export const Button = () => null"
      );
      await writeFile(join(tempDir, "src", "index.ts"), "export {}");

      const files = await fg("**/*", {
        cwd: tempDir,
        onlyFiles: true,
        absolute: true,
        dot: false,
      });

      expect(files.length).toBe(2);
    });
  });

  describe("isSourceFile", () => {
    it("identifies TypeScript files", () => {
      expect(isSourceFile("test.ts")).toBe(true);
      expect(isSourceFile("test.tsx")).toBe(true);
      expect(isSourceFile("/path/to/file.ts")).toBe(true);
    });

    it("identifies JavaScript files", () => {
      expect(isSourceFile("test.js")).toBe(true);
      expect(isSourceFile("test.jsx")).toBe(true);
      expect(isSourceFile("test.mjs")).toBe(true);
    });

    it("identifies Python files", () => {
      expect(isSourceFile("script.py")).toBe(true);
    });

    it("identifies Go files", () => {
      expect(isSourceFile("main.go")).toBe(true);
    });

    it("identifies Rust files", () => {
      expect(isSourceFile("lib.rs")).toBe(true);
    });

    it("identifies config files", () => {
      expect(isSourceFile("config.json")).toBe(true);
      expect(isSourceFile("config.yaml")).toBe(true);
      expect(isSourceFile("config.yml")).toBe(true);
      expect(isSourceFile("README.md")).toBe(true);
    });

    it("rejects unsupported files", () => {
      expect(isSourceFile("image.png")).toBe(false);
      expect(isSourceFile("styles.css")).toBe(false);
      expect(isSourceFile("data.csv")).toBe(false);
      expect(isSourceFile("binary.exe")).toBe(false);
    });

    it("handles case insensitivity", () => {
      expect(isSourceFile("TEST.TS")).toBe(true);
      expect(isSourceFile("App.TSX")).toBe(true);
    });
  });

  describe("readSourceFile", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("reads file contents as UTF-8", async () => {
      const content = "export function test() { return 42; }";
      const filepath = join(tempDir, "test.ts");
      await writeFile(filepath, content);

      const result = await readSourceFile(filepath);
      expect(result).toBe(content);
    });

    it("preserves unicode characters", async () => {
      const content = "// 日本語コメント\nexport const greeting = '你好';";
      const filepath = join(tempDir, "unicode.ts");
      await writeFile(filepath, content);

      const result = await readSourceFile(filepath);
      expect(result).toBe(content);
    });

    it("throws error for non-existent file", async () => {
      await expect(readSourceFile(join(tempDir, "nonexistent.ts"))).rejects.toThrow();
    });
  });

  describe("getRelativePath", () => {
    it("extracts relative path from absolute path", () => {
      const basePath = "/Users/test/project";
      const filepath = "/Users/test/project/src/index.ts";
      expect(getRelativePath(filepath, basePath)).toBe("src/index.ts");
    });

    it("handles trailing slash in base path", () => {
      const basePath = "/Users/test/project/";
      const filepath = "/Users/test/project/src/index.ts";
      expect(getRelativePath(filepath, basePath)).toBe("src/index.ts");
    });

    it("returns original path if not under base", () => {
      const basePath = "/Users/test/project";
      const filepath = "/Users/other/file.ts";
      expect(getRelativePath(filepath, basePath)).toBe("/Users/other/file.ts");
    });

    it("handles root-level files", () => {
      const basePath = "/Users/test/project";
      const filepath = "/Users/test/project/index.ts";
      expect(getRelativePath(filepath, basePath)).toBe("index.ts");
    });
  });
});

describe("Ingest Command Batch Processing", () => {
  it("processes files with concurrency limit", async () => {
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(2);
    const processed: number[] = [];
    const startTimes: number[] = [];

    const tasks = [1, 2, 3, 4, 5].map((n) =>
      limit(async () => {
        startTimes.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 10));
        processed.push(n);
        return n;
      })
    );

    await Promise.all(tasks);

    expect(processed).toHaveLength(5);
    expect(processed).toContain(1);
    expect(processed).toContain(5);
  });
});
