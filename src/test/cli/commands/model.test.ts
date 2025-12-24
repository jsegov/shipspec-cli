import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { modelCommand } from "../../../cli/commands/model.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { join } from "path";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { logger } from "../../../utils/logger.js";

describe("modelCommand", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);
    vi.clearAllMocks();
    vi.spyOn(logger, "info").mockImplementation(vi.fn());
    vi.spyOn(logger, "success").mockImplementation(vi.fn());
    vi.spyOn(logger, "plain").mockImplementation(vi.fn());
    modelCommand.exitOverride();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupTempDir(tempDir);
    vi.restoreAllMocks();
  });

  describe("list", () => {
    it("should list available models", async () => {
      await modelCommand.parseAsync(["node", "test", "list"]);
      expect(logger.info).toHaveBeenCalledWith("Available models:");
      expect(logger.plain).toHaveBeenCalledWith(expect.stringContaining("gemini-flash"));
      expect(logger.plain).toHaveBeenCalledWith(expect.stringContaining("claude-sonnet"));
      expect(logger.plain).toHaveBeenCalledWith(expect.stringContaining("gpt-pro"));
    });
  });

  describe("current", () => {
    it("should show default model when no config exists", async () => {
      await modelCommand.parseAsync(["node", "test", "current"]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("google/gemini-3-flash-preview")
      );
    });

    it("should show configured model from shipspec.json", async () => {
      const configPath = join(tempDir, "shipspec.json");
      await writeFile(
        configPath,
        JSON.stringify({ llm: { modelName: "anthropic/claude-sonnet-4.5" } })
      );

      await modelCommand.parseAsync(["node", "test", "current"]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("anthropic/claude-sonnet-4.5")
      );
    });
  });

  describe("set", () => {
    it("should set model by alias", async () => {
      await modelCommand.parseAsync(["node", "test", "set", "claude-sonnet"]);

      const configPath = join(tempDir, "shipspec.json");
      expect(existsSync(configPath)).toBe(true);

      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        llm: { modelName: string };
      };
      expect(content.llm.modelName).toBe("anthropic/claude-sonnet-4.5");
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("anthropic/claude-sonnet-4.5")
      );
    });

    it("should set model by full name", async () => {
      await modelCommand.parseAsync(["node", "test", "set", "openai/gpt-5.2-pro"]);

      const configPath = join(tempDir, "shipspec.json");
      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        llm: { modelName: string };
      };
      expect(content.llm.modelName).toBe("openai/gpt-5.2-pro");
    });

    it("should create shipspec.json if it doesn't exist", async () => {
      const configPath = join(tempDir, "shipspec.json");
      expect(existsSync(configPath)).toBe(false);

      await modelCommand.parseAsync(["node", "test", "set", "gemini-flash"]);

      expect(existsSync(configPath)).toBe(true);
      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        llm: { modelName: string };
      };
      expect(content.llm.modelName).toBe("google/gemini-3-flash-preview");
    });

    it("should preserve other config fields when setting model", async () => {
      const configPath = join(tempDir, "shipspec.json");
      await writeFile(
        configPath,
        JSON.stringify({ projectPath: "./custom", llm: { temperature: 0.5 } })
      );

      await modelCommand.parseAsync(["node", "test", "set", "gpt-pro"]);

      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        projectPath: string;
        llm: { temperature: number; modelName: string };
      };
      expect(content.projectPath).toBe("./custom");
      expect(content.llm.temperature).toBe(0.5);
      expect(content.llm.modelName).toBe("openai/gpt-5.2-pro");
    });

    it("should throw error for unsupported model", async () => {
      await expect(
        modelCommand.parseAsync(["node", "test", "set", "invalid-model"])
      ).rejects.toThrow(/Invalid model: "invalid-model"/);
    });
  });
});
