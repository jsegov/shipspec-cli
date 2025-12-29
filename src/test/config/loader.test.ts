import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile } from "fs/promises";
import { join } from "path";
import { createTempDir, cleanupTempDir } from "../fixtures.js";
import { loadConfig, ShipSpecEnvSchema } from "../../config/loader.js";
import { logger } from "../../utils/logger.js";
import { type ShipSpecConfig } from "../../config/schema.js";

describe("Config Loader", () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tempDir = await createTempDir();
    process.env = { ...originalEnv };
    delete process.env.SHIPSPEC_STRICT_CONFIG;
    delete process.env.NODE_ENV;
    vi.spyOn(logger, "warn").mockImplementation(vi.fn());
    vi.spyOn(logger, "debug").mockImplementation(vi.fn());
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should include SHIPSPEC_DEBUG_DIAGNOSTICS_ACK in env schema parsing", () => {
    process.env.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK = "I_UNDERSTAND_SECURITY_RISK";

    const result = ShipSpecEnvSchema.safeParse(process.env);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SHIPSPEC_DEBUG_DIAGNOSTICS_ACK).toBe("I_UNDERSTAND_SECURITY_RISK");
    }
  });

  it("should load a valid config file", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, JSON.stringify({ projectPath: "./custom" }));

    const { config } = await loadConfig(tempDir);
    expect(config.projectPath).toBe("./custom");
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Loaded config from"), true);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("shipspec.json"), true);
  });

  it("should warn but continue on malformed JSON in non-strict mode", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, "{ invalid json }");

    const { config } = await loadConfig(tempDir);
    expect(config).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Malformed JSON"));
  });

  it("should throw on malformed JSON in strict mode (option)", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, "{ invalid json }");

    await expect(loadConfig(tempDir, {}, { strict: true })).rejects.toThrow("Malformed JSON");
  });

  it("should throw on malformed JSON in strict mode (env)", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, "{ invalid json }");
    process.env.SHIPSPEC_STRICT_CONFIG = "1";

    await expect(loadConfig(tempDir)).rejects.toThrow("Malformed JSON");
  });

  it("should throw on malformed JSON in production mode", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, "{ invalid json }");
    process.env.NODE_ENV = "production";

    await expect(loadConfig(tempDir)).rejects.toThrow("Malformed JSON");
  });

  it("should warn but continue on schema mismatch in non-strict mode", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, JSON.stringify({ unknownKey: "typo" }));

    const { config } = await loadConfig(tempDir);
    expect(config).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid config in"));
  });

  it("should throw on schema mismatch in strict mode", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, JSON.stringify({ unknownKey: "typo" }));

    await expect(loadConfig(tempDir, {}, { strict: true })).rejects.toThrow("Invalid config in");
  });

  it("should throw if the final merged config is fundamentally invalid", async () => {
    // This tests the final ShipSpecConfigSchema.parse(merged)
    // We use an partial override here because an invalid file config would be ignored in non-strict mode
    const invalidOverride = { llm: { temperature: 5 } } as unknown as Partial<ShipSpecConfig>;
    await expect(loadConfig(tempDir, invalidOverride)).rejects.toThrow(
      "Final merged configuration is invalid"
    );
  });

  it("should respect overrides over file config", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, JSON.stringify({ projectPath: "./file" }));

    const { config } = await loadConfig(tempDir, { projectPath: "./override" });
    expect(config.projectPath).toBe("./override");
  });

  it("should continue to next config file when first file is invalid in non-strict mode", async () => {
    // Create invalid first config file (shipspec.json)
    const firstConfigPath = join(tempDir, "shipspec.json");
    await writeFile(firstConfigPath, JSON.stringify({ unknownKey: "invalid" }));

    // Create valid second config file (.shipspecrc)
    const secondConfigPath = join(tempDir, ".shipspecrc");
    await writeFile(secondConfigPath, JSON.stringify({ projectPath: "./valid" }));

    const { config } = await loadConfig(tempDir);
    expect(config.projectPath).toBe("./valid");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid config in"));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Loaded config from"), true);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(".shipspecrc"), true);
  });

  it("should strip unknown keys in nested config objects instead of rejecting", async () => {
    // Regression test: config files with extra nested fields should work
    // (keys are stripped, not rejected)
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(
      configPath,
      JSON.stringify({
        projectPath: "./custom",
        llm: {
          provider: "openrouter",
          customOption: "should-be-stripped", // Unknown nested key
          anotherUnknown: 123,
        },
        embedding: {
          provider: "openrouter",
          futureFeature: true, // Unknown nested key
        },
      })
    );

    const { config } = await loadConfig(tempDir);

    // Config should load successfully
    expect(config.projectPath).toBe("./custom");
    expect(config.llm.provider).toBe("openrouter");
    expect(config.embedding.provider).toBe("openrouter");

    // Unknown keys should be stripped (not present in result)
    expect("customOption" in config.llm).toBe(false);
    expect("anotherUnknown" in config.llm).toBe(false);
    expect("futureFeature" in config.embedding).toBe(false);

    // Should NOT have warned about invalid config (it's valid, just with extra keys)
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Loaded config from"), true);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("shipspec.json"), true);
  });

  it("should still reject unknown top-level keys", async () => {
    // Top-level unknown keys should still be rejected to catch typos
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(
      configPath,
      JSON.stringify({
        projectPath: "./custom",
        lm: { provider: "openai" }, // Typo: "lm" instead of "llm"
      })
    );

    const { config } = await loadConfig(tempDir);

    // In non-strict mode, the invalid config file is skipped with a warning
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid config in"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Unrecognized key"));

    // Falls back to defaults
    expect(config.projectPath).toBe(".");
  });

  it("should hide dotenv path in production logs", async () => {
    const dotenvPath = join(tempDir, ".env");
    await writeFile(dotenvPath, "OPENROUTER_API_KEY=test");

    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    process.env.SHIPSPEC_DOTENV_PATH = dotenvPath;

    await loadConfig(tempDir);

    expect(logger.warn).toHaveBeenCalled();
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const dotenvLogCall = warnCalls.find((call) => call[0].includes("Loaded dotenv configuration"));

    expect(dotenvLogCall).toBeDefined();
    expect(dotenvLogCall?.[0]).not.toContain(dotenvPath);
    expect(dotenvLogCall?.[0]).toContain("path hidden for security");
  });

  describe("secret extraction and redaction", () => {
    it("should move api keys from file config into secrets and strip from config output", async () => {
      const configPath = join(tempDir, "shipspec.json");
      await writeFile(
        configPath,
        JSON.stringify({
          llm: { apiKey: "file-llm-key", provider: "openrouter" },
          embedding: { apiKey: "file-embedding-key", provider: "openrouter" },
          productionalize: { webSearch: { apiKey: "file-search-key" } },
        })
      );

      const { config, secrets } = await loadConfig(tempDir);

      expect(secrets.llmApiKey).toBe("file-llm-key");
      expect(secrets.embeddingApiKey).toBe("file-embedding-key");
      expect(secrets.tavilyApiKey).toBe("file-search-key");

      expect("apiKey" in config.llm).toBe(false);
      expect("apiKey" in config.embedding).toBe(false);
      expect("apiKey" in (config.productionalize.webSearch ?? {})).toBe(false);
    });

    it("should prioritize overrides over env and file secrets", async () => {
      const configPath = join(tempDir, "shipspec.json");
      await writeFile(
        configPath,
        JSON.stringify({
          llm: { apiKey: "file-llm-key", provider: "openrouter" },
          embedding: { apiKey: "file-embedding-key", provider: "openrouter" },
          productionalize: { webSearch: { apiKey: "file-search-key" } },
        })
      );

      process.env.OPENROUTER_API_KEY = "env-openrouter-key";
      process.env.TAVILY_API_KEY = "env-tavily-key";

      const overrides: ShipSpecConfig = {
        llm: {
          apiKey: "override-llm-key",
          provider: "openrouter",
          modelName: "model",
          temperature: 0,
          maxRetries: 1,
          maxContextTokens: 1,
          reservedOutputTokens: 1,
        },
        embedding: {
          apiKey: "override-embedding-key",
          provider: "openrouter",
          modelName: "model",
          dimensions: "auto",
          maxRetries: 1,
        },
        productionalize: {
          webSearch: { apiKey: "override-search-key", provider: "tavily" },
          coreCategories: [],
        },
        projectPath: ".",
        vectorDbPath: ".ship-spec/lancedb",
        ignorePatterns: [],
        checkpoint: { enabled: false, type: "memory" },
      };

      const { config, secrets } = await loadConfig(tempDir, overrides);

      expect(secrets.llmApiKey).toBe("override-llm-key");
      expect(secrets.embeddingApiKey).toBe("override-embedding-key");
      expect(secrets.tavilyApiKey).toBe("override-search-key");

      expect("apiKey" in config.llm).toBe(false);
      expect("apiKey" in config.embedding).toBe(false);
      expect("apiKey" in (config.productionalize.webSearch ?? {})).toBe(false);
    });
  });

  describe("path disclosure prevention", () => {
    it("should hide absolute path in production config load logs", async () => {
      const configPath = join(tempDir, "shipspec.json");
      await writeFile(configPath, JSON.stringify({ projectPath: "./custom" }));

      process.env.NODE_ENV = "production";

      await loadConfig(tempDir);

      const debugCalls = vi.mocked(logger.debug).mock.calls;
      const configLogCall = debugCalls.find((call) => call[0].includes("Loaded config from"));

      expect(configLogCall).toBeDefined();
      // Should contain only the basename, not the full absolute path
      expect(configLogCall?.[0]).toContain("shipspec.json");
      expect(configLogCall?.[0]).not.toContain(tempDir);
    });

    it("should hide absolute path in non-production without verbose flag", async () => {
      const configPath = join(tempDir, "shipspec.json");
      await writeFile(configPath, JSON.stringify({ projectPath: "./custom" }));

      process.env.NODE_ENV = "development";
      // Ensure --verbose is not in process.argv for this test
      const originalArgv = process.argv;
      process.argv = process.argv.filter((arg) => arg !== "--verbose");

      await loadConfig(tempDir);

      process.argv = originalArgv;

      const debugCalls = vi.mocked(logger.debug).mock.calls;
      const configLogCall = debugCalls.find((call) => call[0].includes("Loaded config from"));

      expect(configLogCall).toBeDefined();
      // Should contain only the basename
      expect(configLogCall?.[0]).toContain("shipspec.json");
      expect(configLogCall?.[0]).not.toContain(tempDir);
    });

    it("should hide absolute path in production error for missing config", async () => {
      process.env.NODE_ENV = "production";
      const missingPath = "/some/absolute/path/to/config.json";

      await expect(loadConfig(tempDir, {}, { configPath: missingPath })).rejects.toThrow(
        /Config file not found: config\.json/
      );

      // Verify the absolute path is NOT in the error
      try {
        await loadConfig(tempDir, {}, { configPath: missingPath });
      } catch (err) {
        expect((err as Error).message).not.toContain("/some/absolute/path");
        expect((err as Error).message).toContain(
          "Full paths are hidden for security in production"
        );
      }
    });

    it("should hide absolute path in production error for missing dotenv", async () => {
      process.env.NODE_ENV = "production";
      process.env.SHIPSPEC_LOAD_DOTENV = "1";
      process.env.SHIPSPEC_DOTENV_PATH = "/some/absolute/path/.env";

      await expect(loadConfig(tempDir)).rejects.toThrow(/Dotenv file not found: \.env/);

      // Verify the absolute path is NOT in the error
      try {
        await loadConfig(tempDir);
      } catch (err) {
        expect((err as Error).message).not.toContain("/some/absolute/path");
        expect((err as Error).message).toContain(
          "Full paths are hidden for security in production"
        );
      }
    });

    it("should hide absolute path in malformed JSON warning in production", async () => {
      const configPath = join(tempDir, "shipspec.json");
      await writeFile(configPath, "{ invalid json }");

      process.env.NODE_ENV = "production";

      // strict mode is auto-enabled in production, so it will throw
      await expect(loadConfig(tempDir)).rejects.toThrow(/Malformed JSON/);

      // Verify the error message contains only the basename
      try {
        await loadConfig(tempDir);
      } catch (err) {
        expect((err as Error).message).toContain("shipspec.json");
        expect((err as Error).message).not.toContain(tempDir);
      }
    });

    it("should hide absolute path in invalid config warning in production", async () => {
      const configPath = join(tempDir, "shipspec.json");
      await writeFile(configPath, JSON.stringify({ unknownKey: "typo" }));

      process.env.NODE_ENV = "production";

      // strict mode is auto-enabled in production, so it will throw
      await expect(loadConfig(tempDir)).rejects.toThrow(/Invalid config in/);

      // Verify the error message contains only the basename
      try {
        await loadConfig(tempDir);
      } catch (err) {
        expect((err as Error).message).toContain("shipspec.json");
        expect((err as Error).message).not.toContain(tempDir);
      }
    });
  });

  describe("ALLOW_LOCALHOST_LLM production guardrail", () => {
    it("should throw in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOW_LOCALHOST_LLM = "1";

      await expect(loadConfig(tempDir)).rejects.toThrow("strictly prohibited in production");
    });

    it("should succeed in non-production", async () => {
      process.env.NODE_ENV = "development";
      process.env.ALLOW_LOCALHOST_LLM = "1";

      const { config } = await loadConfig(tempDir);
      expect(config).toBeDefined();
    });
  });
});
