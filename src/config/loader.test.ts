import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./loader.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("loadConfig - dotenv CI safety", () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    // Save original environment
    originalEnv = { ...process.env };

    // Create temp directory for test
    testDir = await mkdtemp(join(tmpdir(), "loader-test-"));
  });

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv;

    // Clean up temp directory
    if (testDir && existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should NOT load .env in CI without explicit opt-in", async () => {
    // Create .env file with test value
    const envPath = join(testDir, ".env");
    await writeFile(envPath, "TEST_CI_VAR=should-not-be-loaded\n");

    // Set CI environment
    process.env.CI = "true";
    process.env.NODE_ENV = "development";
    process.env.SHIPSPEC_DOTENV_PATH = envPath;
    delete process.env.SHIPSPEC_LOAD_DOTENV;
    delete process.env.TEST_CI_VAR;

    // Load config
    await loadConfig(testDir);

    // .env should NOT be loaded
    expect(process.env.TEST_CI_VAR).toBeUndefined();
  });

  it("should load .env in CI with explicit opt-in", async () => {
    // Create .env file
    const envPath = join(testDir, ".env");
    await writeFile(envPath, "TEST_CI_OPT_IN=loaded-in-ci\n");

    // Set CI environment with opt-in
    process.env.CI = "true";
    process.env.NODE_ENV = "development";
    process.env.SHIPSPEC_DOTENV_PATH = envPath;
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    delete process.env.TEST_CI_OPT_IN;

    // Load config
    await loadConfig(testDir);

    // .env SHOULD be loaded
    expect(process.env.TEST_CI_OPT_IN).toBe("loaded-in-ci");
  });

  it("should load .env in local dev by default (no CI)", async () => {
    // Create .env file
    const envPath = join(testDir, ".env");
    await writeFile(envPath, "TEST_LOCAL_VAR=loaded-in-local\n");

    // Set local dev environment
    delete process.env.CI;
    process.env.NODE_ENV = "development";
    process.env.SHIPSPEC_DOTENV_PATH = envPath;
    delete process.env.SHIPSPEC_LOAD_DOTENV;
    delete process.env.TEST_LOCAL_VAR;

    // Load config
    await loadConfig(testDir);

    // .env SHOULD be loaded
    expect(process.env.TEST_LOCAL_VAR).toBe("loaded-in-local");
  });

  it("should respect verbose option instead of process.argv", async () => {
    // This test verifies that verbose is passed via options, not read from process.argv
    const envPath = join(testDir, ".env");

    // Set NODE_ENV to development and provide explicit (non-existent) path
    process.env.NODE_ENV = "development";
    process.env.SHIPSPEC_DOTENV_PATH = envPath; // File doesn't exist
    delete process.env.CI;

    // Should throw with safe path (basename only) when verbose=false
    await expect(loadConfig(testDir, {}, { verbose: false })).rejects.toThrow(/\.env/); // Should show basename, not full path

    // Path in error should be basename, not full path
    try {
      await loadConfig(testDir, {}, { verbose: false });
    } catch (err) {
      const error = err as Error;
      expect(error.message).not.toContain(testDir);
      expect(error.message).toContain(".env");
    }
  });

  it("should show full path in verbose mode", async () => {
    const envPath = join(testDir, "nonexistent.env");

    process.env.NODE_ENV = "development";
    process.env.SHIPSPEC_DOTENV_PATH = envPath;
    delete process.env.CI;

    // Should show full path when verbose=true
    try {
      await loadConfig(testDir, {}, { verbose: true });
    } catch (err) {
      const error = err as Error;
      expect(error.message).toContain(testDir);
      expect(error.message).toContain("nonexistent.env");
    }
  });

  it("should handle CI=1 as truthy", async () => {
    const envPath = join(testDir, ".env");
    await writeFile(envPath, "TEST_CI_ONE=value\n");

    // Set CI=1 (string "1" is also truthy for CI check)
    process.env.CI = "1";
    process.env.NODE_ENV = "development";
    process.env.SHIPSPEC_DOTENV_PATH = envPath;
    delete process.env.SHIPSPEC_LOAD_DOTENV;
    delete process.env.TEST_CI_ONE;

    await loadConfig(testDir);

    // Should NOT load .env (CI=1 should be treated same as CI=true)
    expect(process.env.TEST_CI_ONE).toBeUndefined();
  });

  it("should require explicit opt-in in production", async () => {
    const envPath = join(testDir, ".env");
    await writeFile(envPath, "TEST_PROD_VAR=production-value\n");

    // Set production environment without opt-in
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_DOTENV_PATH = envPath;
    delete process.env.SHIPSPEC_LOAD_DOTENV;
    delete process.env.CI;
    delete process.env.TEST_PROD_VAR;

    // Should throw because production requires absolute path
    await expect(loadConfig(testDir)).rejects.toThrow(/absolute path/);
  });

  it("should allow dotenv in production with explicit acknowledgement", async () => {
    const envPath = join(testDir, ".env");
    await writeFile(envPath, "TEST_PROD_ALLOWED=prod-allowed\n");

    // Set production with explicit opt-in and absolute path
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_DOTENV_PATH = envPath;
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    delete process.env.CI;
    delete process.env.TEST_PROD_ALLOWED;

    await loadConfig(testDir);

    expect(process.env.TEST_PROD_ALLOWED).toBe("prod-allowed");
  });
});
