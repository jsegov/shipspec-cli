import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import fg from "fast-glob";

import { createTempDir, cleanupTempDir, TS_FIXTURE, PYTHON_FIXTURE } from "../fixtures.js";
import { chunkSourceFile } from "../../core/parsing/index.js";
import { readSourceFile, isSourceFile, getRelativePath } from "../../utils/fs.js";
import { LanceDBManager } from "../../core/storage/vector-store.js";
import { DocumentRepository } from "../../core/storage/repository.js";
import { Embeddings } from "@langchain/core/embeddings";
import type { CodeChunk } from "../../core/types/index.js";

/**
 * Mock embeddings for testing without external API calls.
 */
class MockEmbeddings extends Embeddings {
  constructor(private dimensions: number = 3072) {
    super({});
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(0.1));
  }

  async embedQuery(_text: string): Promise<number[]> {
    return new Array(this.dimensions).fill(0.1);
  }
}

describe("CLI Integration Tests", () => {
  describe("Ingest Pipeline Integration", () => {
    let tempDir: string;
    let projectDir: string;
    let dbDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir();
      projectDir = join(tempDir, "project");
      dbDir = join(tempDir, "lancedb");
      await mkdir(projectDir, { recursive: true });
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("full ingest flow: discover -> chunk -> store", async () => {
      // Setup: Create source files
      await mkdir(join(projectDir, "src"), { recursive: true });
      await writeFile(join(projectDir, "src", "math.ts"), TS_FIXTURE);
      await writeFile(join(projectDir, "src", "utils.py"), PYTHON_FIXTURE);
      await writeFile(join(projectDir, "config.json"), '{"name": "test"}');

      // Step 1: Discover files
      const files = await fg("**/*", {
        cwd: projectDir,
        ignore: ["**/node_modules/**", "**/.git/**"],
        onlyFiles: true,
        absolute: true,
        dot: false,
      });

      const sourceFiles = files.filter(isSourceFile);
      expect(sourceFiles.length).toBe(3);

      // Step 2: Chunk files
      const allChunks: CodeChunk[] = [];
      for (const file of sourceFiles) {
        const content = await readSourceFile(file);
        const relativePath = getRelativePath(file, projectDir);
        const chunks = await chunkSourceFile(relativePath, content);

        // Add IDs to chunks
        const chunksWithIds = chunks.map((chunk, i) => ({
          ...chunk,
          id: `${relativePath}-${i}`,
          filepath: relativePath,
        }));

        allChunks.push(...chunksWithIds);
      }

      expect(allChunks.length).toBeGreaterThan(0);

      // Verify TypeScript chunks include functions and classes
      const tsChunks = allChunks.filter((c) => c.language === "typescript");
      expect(tsChunks.some((c) => c.type === "function")).toBe(true);
      expect(tsChunks.some((c) => c.type === "class")).toBe(true);

      // Step 3: Store in vector database
      const vectorStore = new LanceDBManager(dbDir);
      const embeddings = new MockEmbeddings(3072);
      const repository = new DocumentRepository(vectorStore, embeddings, 3072);

      await repository.addDocuments(allChunks);

      // Step 4: Verify retrieval works
      const searchResults = await repository.similaritySearch("add function", 5);
      expect(searchResults.length).toBeGreaterThan(0);
    });

    it("handles empty directories gracefully", async () => {
      const files = await fg("**/*", {
        cwd: projectDir,
        onlyFiles: true,
        absolute: true,
        dot: false,
      });

      expect(files.length).toBe(0);
    });

    it("skips unsupported file types", async () => {
      await writeFile(join(projectDir, "styles.css"), "body { color: red; }");
      await writeFile(join(projectDir, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      await writeFile(join(projectDir, "valid.ts"), "export const x = 1;");

      const files = await fg("**/*", {
        cwd: projectDir,
        onlyFiles: true,
        absolute: true,
        dot: false,
      });

      const sourceFiles = files.filter(isSourceFile);
      expect(sourceFiles.length).toBe(1);
      expect(sourceFiles[0]).toContain("valid.ts");
    });

    it("respects ignore patterns from config", async () => {
      const ignorePatterns = [
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
        "**/*.test.ts",
      ];

      // Create files that should be ignored
      await mkdir(join(projectDir, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(projectDir, "node_modules", "pkg", "index.js"), "module.exports = {}");

      await mkdir(join(projectDir, "dist"), { recursive: true });
      await writeFile(join(projectDir, "dist", "bundle.js"), "// bundled");

      await mkdir(join(projectDir, "src"), { recursive: true });
      await writeFile(join(projectDir, "src", "app.ts"), "export {}");
      await writeFile(join(projectDir, "src", "app.test.ts"), "import { test } from 'vitest'");

      const files = await fg("**/*", {
        cwd: projectDir,
        ignore: ignorePatterns,
        onlyFiles: true,
        absolute: true,
        dot: false,
      });

      expect(files.length).toBe(1);
      expect(files[0]).toContain("app.ts");
      expect(files[0]).not.toContain(".test.ts");
    });
  });

  describe("Chunking Quality", () => {
    it("preserves code structure in TypeScript chunks", async () => {
      const content = `export function add(a: number, b: number): number {
  return a + b;
}

export class Calculator {
  private value: number = 0;

  add(n: number): this {
    this.value += n;
    return this;
  }

  getValue(): number {
    return this.value;
  }
}

export interface Config {
  debug: boolean;
  apiKey?: string;
}
`;

      const chunks = await chunkSourceFile("math.ts", content);

      // Should have function, class, and interface chunks
      const functionChunk = chunks.find((c) => c.type === "function");
      const classChunk = chunks.find((c) => c.type === "class");
      const interfaceChunk = chunks.find((c) => c.type === "interface");

      expect(functionChunk).toBeDefined();
      expect(functionChunk?.content).toContain("function add");
      expect(functionChunk?.symbolName).toBe("add");

      expect(classChunk).toBeDefined();
      expect(classChunk?.content).toContain("class Calculator");
      expect(classChunk?.symbolName).toBe("Calculator");

      expect(interfaceChunk).toBeDefined();
      expect(interfaceChunk?.content).toContain("interface Config");
      expect(interfaceChunk?.symbolName).toBe("Config");
    });

    it("handles malformed code with fallback", async () => {
      // Content that is long enough to produce chunks via fallback splitter
      const malformedContent = `
function broken( {
  return 1 +
}

const x = 

// This is a longer piece of malformed content
// that should trigger the fallback splitter
// when tree-sitter cannot parse it properly
// or when no valid AST nodes are found.

const unfinished = {
  property: "value",
  another: 
}

export const more = 
`;

      // Should not throw - either parses partially or uses fallback
      const chunks = await chunkSourceFile("broken.ts", malformedContent);
      // Either chunks are extracted or fallback produces at least one chunk
      // The important thing is it doesn't throw
      expect(Array.isArray(chunks)).toBe(true);
    });

    it("processes JSON files with fallback splitter", async () => {
      const jsonContent = JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          typescript: "^5.0.0",
          vitest: "^1.0.0",
        },
      }, null, 2);

      const chunks = await chunkSourceFile("package.json", jsonContent);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].language).toBe("json");
    });
  });

  describe("Vector Store Integration", () => {
    let tempDir: string;
    let vectorStore: LanceDBManager;
    let repository: DocumentRepository;

    beforeEach(async () => {
      tempDir = await createTempDir();
      vectorStore = new LanceDBManager(tempDir);
      const embeddings = new MockEmbeddings(3072);
      repository = new DocumentRepository(vectorStore, embeddings, 3072);
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("stores and retrieves chunks correctly", async () => {
      const chunks: CodeChunk[] = [
        {
          id: "auth-1",
          content: "export function authenticate(user: User) { ... }",
          filepath: "src/auth.ts",
          startLine: 1,
          endLine: 10,
          language: "typescript",
          type: "function",
          symbolName: "authenticate",
        },
        {
          id: "db-1",
          content: "export async function connectDatabase() { ... }",
          filepath: "src/database.ts",
          startLine: 1,
          endLine: 15,
          language: "typescript",
          type: "function",
          symbolName: "connectDatabase",
        },
      ];

      await repository.addDocuments(chunks);

      const results = await repository.similaritySearch("authentication", 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it("supports hybrid search", async () => {
      const chunks: CodeChunk[] = [
        {
          id: "chunk-1",
          content: "const JWT_SECRET = process.env.JWT_SECRET;",
          filepath: "src/config.ts",
          startLine: 1,
          endLine: 1,
          language: "typescript",
          type: "module",
        },
        {
          id: "chunk-2",
          content: "export function validateToken(token: string) { ... }",
          filepath: "src/auth.ts",
          startLine: 10,
          endLine: 20,
          language: "typescript",
          type: "function",
          symbolName: "validateToken",
        },
      ];

      await repository.addDocuments(chunks);

      const results = await repository.hybridSearch("JWT token validation", 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles batch insertions efficiently", async () => {
      const chunks: CodeChunk[] = Array.from({ length: 100 }, (_, i) => ({
        id: `chunk-${i}`,
        content: `function func${i}() { return ${i}; }`,
        filepath: `src/file${Math.floor(i / 10)}.ts`,
        startLine: (i % 10) * 5 + 1,
        endLine: (i % 10) * 5 + 4,
        language: "typescript",
        type: "function",
        symbolName: `func${i}`,
      }));

      const startTime = Date.now();
      await repository.addDocuments(chunks);
      const elapsed = Date.now() - startTime;

      // Should complete in reasonable time (less than 30 seconds)
      expect(elapsed).toBeLessThan(30000);

      const results = await repository.similaritySearch("function", 10);
      expect(results.length).toBe(10);
    });
  });

  describe("End-to-End Workflow", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });

    it("simulates complete ingest and query workflow", async () => {
      const projectDir = join(tempDir, "project");
      const dbDir = join(tempDir, "lancedb");
      await mkdir(projectDir, { recursive: true });

      // Create a small codebase
      await mkdir(join(projectDir, "src"), { recursive: true });
      await writeFile(
        join(projectDir, "src", "auth.ts"),
        `
/**
 * Authenticates a user with the given credentials.
 */
export async function authenticateUser(email: string, password: string): Promise<User | null> {
  const user = await findUserByEmail(email);
  if (!user) return null;
  
  const isValid = await comparePassword(password, user.passwordHash);
  return isValid ? user : null;
}

/**
 * Generates a JWT token for the authenticated user.
 */
export function generateToken(user: User): string {
  return jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
    expiresIn: '24h'
  });
}
`
      );

      await writeFile(
        join(projectDir, "src", "database.ts"),
        `
/**
 * Database connection manager.
 */
export class DatabaseConnection {
  private pool: Pool;

  async connect(): Promise<void> {
    this.pool = await createPool({
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
    });
  }

  async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    const client = await this.pool.acquire();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }
}
`
      );

      // Step 1: Discover and chunk files
      const files = await fg("**/*.ts", {
        cwd: projectDir,
        onlyFiles: true,
        absolute: true,
      });

      const allChunks: CodeChunk[] = [];
      for (const file of files) {
        const content = await readSourceFile(file);
        const relativePath = getRelativePath(file, projectDir);
        const chunks = await chunkSourceFile(relativePath, content);
        allChunks.push(
          ...chunks.map((c, i) => ({
            ...c,
            id: `${relativePath}-${i}`,
            filepath: relativePath,
          }))
        );
      }

      expect(allChunks.length).toBeGreaterThan(0);

      // Step 2: Index into vector store
      const vectorStore = new LanceDBManager(dbDir);
      const embeddings = new MockEmbeddings(3072);
      const repository = new DocumentRepository(vectorStore, embeddings, 3072);

      await repository.addDocuments(allChunks);

      // Step 3: Query the indexed codebase
      const authResults = await repository.similaritySearch("user authentication", 5);
      expect(authResults.length).toBeGreaterThan(0);

      const dbResults = await repository.similaritySearch("database connection", 5);
      expect(dbResults.length).toBeGreaterThan(0);
    });
  });
});
