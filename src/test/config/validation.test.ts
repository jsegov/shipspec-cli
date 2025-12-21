import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ShipSpecConfigSchema } from "../../config/schema.js";
import { loadConfig } from "../../config/loader.js";
import { createTempDir, cleanupTempDir } from "../fixtures.js";
import { logger } from "../../utils/logger.js";

describe("Base URL Validation", () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tempDir = await createTempDir();
    process.env = { ...originalEnv };
    delete process.env.ALLOW_LOCALHOST_LLM;
    delete process.env.OLLAMA_BASE_URL;
    vi.spyOn(logger, "warn").mockImplementation(vi.fn());
    vi.spyOn(logger, "debug").mockImplementation(vi.fn());
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Schema Validation", () => {
    it("should accept valid https URL", () => {
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "https://api.openai.com/v1" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.llm.baseUrl).toBe("https://api.openai.com/v1");
      }
    });

    it("should accept valid http URL", () => {
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "http://example.com" },
      });
      expect(result.success).toBe(true);
    });

    it("should normalize trailing slash", () => {
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "https://api.openai.com/v1/" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.llm.baseUrl).toBe("https://api.openai.com/v1");
      }
    });

    it("should reject invalid protocols", () => {
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "file:///etc/passwd" },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
        expect(result.error.issues[0]?.message).toContain("Invalid baseUrl");
      }
    });

    it("should reject URLs with credentials", () => {
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "https://user:pass@example.com" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject metadata IP", () => {
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "http://169.254.169.254/latest/meta-data/" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject localhost by default", () => {
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "http://localhost:11434" },
      });
      expect(result.success).toBe(false);
    });

    it("should reject 127.0.0.1 by default", () => {
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "http://127.0.0.1:11434" },
      });
      expect(result.success).toBe(false);
    });

    it("should accept localhost when ALLOW_LOCALHOST_LLM=1", () => {
      process.env.ALLOW_LOCALHOST_LLM = "1";
      const result = ShipSpecConfigSchema.safeParse({
        llm: { baseUrl: "http://localhost:11434" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Loader Integration", () => {
    it("should validate OLLAMA_BASE_URL from environment", async () => {
      process.env.OLLAMA_BASE_URL = "http://169.254.169.254";
      await expect(loadConfig(tempDir)).rejects.toThrow("Final merged configuration is invalid");
    });

    it("should allow OLLAMA_BASE_URL localhost with opt-in", async () => {
      process.env.OLLAMA_BASE_URL = "http://localhost:11434";
      process.env.ALLOW_LOCALHOST_LLM = "1";
      const config = await loadConfig(tempDir);
      expect(config.llm.baseUrl).toBe("http://localhost:11434");
    });
  });
});
