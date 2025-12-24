import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../config/loader.js";
import { writeFile, rm } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

describe("Configuration Precedence", () => {
  const testCwd = join(process.cwd(), "temp-precedence-test");
  const configPath = join(testCwd, "shipspec.json");
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    if (!existsSync(testCwd)) {
      await import("fs").then((fs) => fs.promises.mkdir(testCwd));
    }
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    if (existsSync(testCwd)) {
      await rm(testCwd, { recursive: true, force: true });
    }
    process.env = originalEnv;
  });

  it("should favor CLI overrides over everything", async () => {
    await writeFile(configPath, JSON.stringify({ llm: { baseUrl: "https://file.com" } }));
    process.env.OLLAMA_BASE_URL = "https://env.com";

    const { config } = await loadConfig(testCwd, { llm: { baseUrl: "https://cli.com" } });
    expect(config.llm.baseUrl).toBe("https://cli.com");
  });

  it("should favor environment variables over file config", async () => {
    await writeFile(configPath, JSON.stringify({ llm: { baseUrl: "https://file.com" } }));
    process.env.OLLAMA_BASE_URL = "https://env.com";

    const { config } = await loadConfig(testCwd, {});
    expect(config.llm.baseUrl).toBe("https://env.com");
  });

  it("should favor file config over defaults", async () => {
    await writeFile(configPath, JSON.stringify({ llm: { baseUrl: "http://file.com" } }));

    const { config } = await loadConfig(testCwd, {});
    expect(config.llm.baseUrl).toBe("http://file.com");
  });

  it("should use defaults if nothing else is provided", async () => {
    // defaults for llm.provider is 'openai', no baseUrl by default
    const { config } = await loadConfig(testCwd, {});
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.baseUrl).toBeUndefined();
  });
});
