import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../config/loader.js";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "fs";
import { readFile } from "fs/promises";

// Mock dotenv
vi.mock("dotenv", () => ({
  config: vi.fn(),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("Dotenv Gating", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.CI;
    delete process.env.SHIPSPEC_LOAD_DOTENV;
    delete process.env.SHIPSPEC_DOTENV_OVERRIDE;
    delete process.env.SHIPSPEC_DOTENV_PATH;
    delete process.env.SHIPSPEC_DOTENV_OVERRIDE_ACK;

    // Only return true for .env paths to avoid loading shipspec.json etc.
    vi.mocked(existsSync).mockImplementation((p: string | Buffer | URL) => {
      const pathStr = String(p);
      return pathStr.includes(".env");
    });
    vi.mocked(readFile).mockResolvedValue("{}");
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should load dotenv in non-production by default", async () => {
    await loadConfig();
    expect(loadDotenv).toHaveBeenCalledWith(
      expect.objectContaining({
        override: false,
      })
    );
  });

  it("should NOT load dotenv in production by default", async () => {
    process.env.NODE_ENV = "production";
    await loadConfig();
    expect(loadDotenv).not.toHaveBeenCalled();
  });

  it("should throw in production if SHIPSPEC_LOAD_DOTENV=1 but no path", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    await expect(loadConfig()).rejects.toThrow(/SHIPSPEC_DOTENV_PATH must be set/);
  });

  it("should throw in production if path is relative", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    process.env.SHIPSPEC_DOTENV_PATH = "./relative/.env";
    await expect(loadConfig()).rejects.toThrow(/must be an absolute path/);
  });

  it("should load in production if absolute path provided", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    process.env.SHIPSPEC_DOTENV_PATH = "/abs/path/.env";
    await loadConfig();
    expect(loadDotenv).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/abs/path/.env",
      })
    );
  });

  it("should throw in production if override is 1 without acknowledgment", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    process.env.SHIPSPEC_DOTENV_PATH = "/abs/path/.env";
    process.env.SHIPSPEC_DOTENV_OVERRIDE = "1";
    await expect(loadConfig()).rejects.toThrow(/requires explicit acknowledgement/);
  });

  it("should work in production if override is 1 with acknowledgment", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    process.env.SHIPSPEC_DOTENV_PATH = "/abs/path/.env";
    process.env.SHIPSPEC_DOTENV_OVERRIDE = "1";
    process.env.SHIPSPEC_DOTENV_OVERRIDE_ACK = "I_UNDERSTAND";
    await loadConfig();
    expect(loadDotenv).toHaveBeenCalledWith(
      expect.objectContaining({
        override: true,
      })
    );
  });

  it("should respect SHIPSPEC_DOTENV_OVERRIDE flag in non-production without ack", async () => {
    process.env.SHIPSPEC_DOTENV_OVERRIDE = "1";
    await loadConfig();
    expect(loadDotenv).toHaveBeenCalledWith(
      expect.objectContaining({
        override: true,
      })
    );
  });

  it("should NOT load dotenv implicitly in CI even if non-production", async () => {
    process.env.CI = "true";
    await loadConfig();
    expect(loadDotenv).not.toHaveBeenCalled();
  });

  it("should load dotenv in CI if SHIPSPEC_LOAD_DOTENV=1 is set", async () => {
    process.env.CI = "true";
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    await loadConfig();
    expect(loadDotenv).toHaveBeenCalled();
  });
});
