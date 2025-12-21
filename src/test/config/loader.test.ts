import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile } from "fs/promises";
import { join } from "path";
import { createTempDir, cleanupTempDir } from "../fixtures.js";
import { loadConfig } from "../../config/loader.js";
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

  it("should load a valid config file", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, JSON.stringify({ projectPath: "./custom" }));

    const config = await loadConfig(tempDir);
    expect(config.projectPath).toBe("./custom");
    expect(logger.debug).toHaveBeenCalledWith("Loaded config from shipspec.json", true);
  });

  it("should warn but continue on malformed JSON in non-strict mode", async () => {
    const configPath = join(tempDir, "shipspec.json");
    await writeFile(configPath, "{ invalid json }");

    const config = await loadConfig(tempDir);
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

    const config = await loadConfig(tempDir);
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

    const config = await loadConfig(tempDir, { projectPath: "./override" });
    expect(config.projectPath).toBe("./override");
  });

  it("should continue to next config file when first file is invalid in non-strict mode", async () => {
    // Create invalid first config file (shipspec.json)
    const firstConfigPath = join(tempDir, "shipspec.json");
    await writeFile(firstConfigPath, JSON.stringify({ unknownKey: "invalid" }));

    // Create valid second config file (.shipspecrc)
    const secondConfigPath = join(tempDir, ".shipspecrc");
    await writeFile(secondConfigPath, JSON.stringify({ projectPath: "./valid" }));

    const config = await loadConfig(tempDir);
    expect(config.projectPath).toBe("./valid");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid config in"));
    expect(logger.debug).toHaveBeenCalledWith("Loaded config from .shipspecrc", true);
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
          provider: "openai",
          customOption: "should-be-stripped", // Unknown nested key
          anotherUnknown: 123,
        },
        embedding: {
          provider: "openai",
          futureFeature: true, // Unknown nested key
        },
      })
    );

    const config = await loadConfig(tempDir);

    // Config should load successfully
    expect(config.projectPath).toBe("./custom");
    expect(config.llm.provider).toBe("openai");
    expect(config.embedding.provider).toBe("openai");

    // Unknown keys should be stripped (not present in result)
    expect("customOption" in config.llm).toBe(false);
    expect("anotherUnknown" in config.llm).toBe(false);
    expect("futureFeature" in config.embedding).toBe(false);

    // Should NOT have warned about invalid config (it's valid, just with extra keys)
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith("Loaded config from shipspec.json", true);
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

    const config = await loadConfig(tempDir);

    // In non-strict mode, the invalid config file is skipped with a warning
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid config in"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Unrecognized key"));

    // Falls back to defaults
    expect(config.projectPath).toBe(".");
  });
});
