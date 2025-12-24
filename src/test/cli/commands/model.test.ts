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

    it("should show configured model from .shipspecrc", async () => {
      const configPath = join(tempDir, ".shipspecrc");
      await writeFile(configPath, JSON.stringify({ llm: { modelName: "openai/gpt-5.2-pro" } }));

      await modelCommand.parseAsync(["node", "test", "current"]);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("openai/gpt-5.2-pro"));
    });

    it("should show configured model from .shipspecrc.json", async () => {
      const configPath = join(tempDir, ".shipspecrc.json");
      await writeFile(
        configPath,
        JSON.stringify({ llm: { modelName: "google/gemini-3-flash-preview" } })
      );

      await modelCommand.parseAsync(["node", "test", "current"]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("google/gemini-3-flash-preview")
      );
    });

    it("should prefer shipspec.json over .shipspecrc", async () => {
      // Create both config files with different models
      await writeFile(
        join(tempDir, "shipspec.json"),
        JSON.stringify({ llm: { modelName: "anthropic/claude-sonnet-4.5" } })
      );
      await writeFile(
        join(tempDir, ".shipspecrc"),
        JSON.stringify({ llm: { modelName: "openai/gpt-5.2-pro" } })
      );

      await modelCommand.parseAsync(["node", "test", "current"]);
      // shipspec.json should take precedence
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("anthropic/claude-sonnet-4.5")
      );
    });
  });

  describe("set", () => {
    it("should set model by alias and provider to openrouter", async () => {
      await modelCommand.parseAsync(["node", "test", "set", "claude-sonnet"]);

      const configPath = join(tempDir, "shipspec.json");
      expect(existsSync(configPath)).toBe(true);

      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        llm: { modelName: string; provider: string };
      };
      expect(content.llm.modelName).toBe("anthropic/claude-sonnet-4.5");
      expect(content.llm.provider).toBe("openrouter");
      expect(logger.success).toHaveBeenCalledWith(
        expect.stringContaining("anthropic/claude-sonnet-4.5")
      );
    });

    it("should set model by full name", async () => {
      await modelCommand.parseAsync(["node", "test", "set", "openai/gpt-5.2-pro"]);

      const configPath = join(tempDir, "shipspec.json");
      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        llm: { modelName: string; provider: string };
      };
      expect(content.llm.modelName).toBe("openai/gpt-5.2-pro");
      expect(content.llm.provider).toBe("openrouter");
    });

    it("should create shipspec.json if it doesn't exist", async () => {
      const configPath = join(tempDir, "shipspec.json");
      expect(existsSync(configPath)).toBe(false);

      await modelCommand.parseAsync(["node", "test", "set", "gemini-flash"]);

      expect(existsSync(configPath)).toBe(true);
      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        llm: { modelName: string; provider: string };
      };
      expect(content.llm.modelName).toBe("google/gemini-3-flash-preview");
      expect(content.llm.provider).toBe("openrouter");
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
        llm: { temperature: number; modelName: string; provider: string };
      };
      expect(content.projectPath).toBe("./custom");
      expect(content.llm.temperature).toBe(0.5);
      expect(content.llm.modelName).toBe("openai/gpt-5.2-pro");
      expect(content.llm.provider).toBe("openrouter");
    });

    it("should override ollama provider when setting OpenRouter model", async () => {
      const configPath = join(tempDir, "shipspec.json");
      // Pre-existing config with Ollama provider
      await writeFile(
        configPath,
        JSON.stringify({
          llm: { provider: "ollama", modelName: "llama3", baseUrl: "http://localhost:11434" },
        })
      );

      await modelCommand.parseAsync(["node", "test", "set", "gemini-flash"]);

      const content = JSON.parse(await readFile(configPath, "utf-8")) as {
        llm: { provider: string; modelName: string; baseUrl?: string };
      };
      // Provider should be overridden to openrouter
      expect(content.llm.provider).toBe("openrouter");
      expect(content.llm.modelName).toBe("google/gemini-3-flash-preview");
      // baseUrl should be preserved (though it won't affect openrouter)
      expect(content.llm.baseUrl).toBe("http://localhost:11434");
    });

    it("should throw error for unsupported model", async () => {
      await expect(
        modelCommand.parseAsync(["node", "test", "set", "invalid-model"])
      ).rejects.toThrow(/Invalid model: "invalid-model"/);
    });

    it("should update existing .shipspecrc instead of creating shipspec.json", async () => {
      const rcPath = join(tempDir, ".shipspecrc");
      await writeFile(rcPath, JSON.stringify({ llm: { temperature: 0.7 } }));

      await modelCommand.parseAsync(["node", "test", "set", "claude-sonnet"]);

      // Should update .shipspecrc, not create shipspec.json
      expect(existsSync(join(tempDir, "shipspec.json"))).toBe(false);
      expect(existsSync(rcPath)).toBe(true);

      const content = JSON.parse(await readFile(rcPath, "utf-8")) as {
        llm: { temperature: number; modelName: string; provider: string };
      };
      expect(content.llm.temperature).toBe(0.7);
      expect(content.llm.modelName).toBe("anthropic/claude-sonnet-4.5");
      expect(content.llm.provider).toBe("openrouter");
    });

    it("should update existing .shipspecrc.json instead of creating shipspec.json", async () => {
      const rcJsonPath = join(tempDir, ".shipspecrc.json");
      await writeFile(rcJsonPath, JSON.stringify({ projectPath: "./src" }));

      await modelCommand.parseAsync(["node", "test", "set", "gpt-pro"]);

      // Should update .shipspecrc.json, not create shipspec.json
      expect(existsSync(join(tempDir, "shipspec.json"))).toBe(false);
      expect(existsSync(rcJsonPath)).toBe(true);

      const content = JSON.parse(await readFile(rcJsonPath, "utf-8")) as {
        projectPath: string;
        llm: { modelName: string; provider: string };
      };
      expect(content.projectPath).toBe("./src");
      expect(content.llm.modelName).toBe("openai/gpt-5.2-pro");
      expect(content.llm.provider).toBe("openrouter");
    });

    it("should update shipspec.json when it exists alongside .shipspecrc", async () => {
      // When multiple config files exist, should update the highest priority one (shipspec.json)
      await writeFile(
        join(tempDir, "shipspec.json"),
        JSON.stringify({ llm: { modelName: "old-model" } })
      );
      await writeFile(
        join(tempDir, ".shipspecrc"),
        JSON.stringify({ llm: { modelName: "other" } })
      );

      await modelCommand.parseAsync(["node", "test", "set", "gemini-flash"]);

      const content = JSON.parse(await readFile(join(tempDir, "shipspec.json"), "utf-8")) as {
        llm: { modelName: string };
      };
      expect(content.llm.modelName).toBe("google/gemini-3-flash-preview");

      // .shipspecrc should remain unchanged
      const rcContent = JSON.parse(await readFile(join(tempDir, ".shipspecrc"), "utf-8")) as {
        llm: { modelName: string };
      };
      expect(rcContent.llm.modelName).toBe("other");
    });
  });
});
