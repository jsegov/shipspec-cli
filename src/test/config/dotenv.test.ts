import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../config/loader.js";
import { config as loadDotenv } from "dotenv";

// Mock dotenv
vi.mock("dotenv", () => ({
  config: vi.fn(),
}));

describe("Dotenv Gating", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.SHIPSPEC_LOAD_DOTENV;
    delete process.env.SHIPSPEC_DOTENV_OVERRIDE;
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

  it("should load dotenv in production if SHIPSPEC_LOAD_DOTENV=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHIPSPEC_LOAD_DOTENV = "1";
    await loadConfig();
    expect(loadDotenv).toHaveBeenCalled();
  });

  it("should respect SHIPSPEC_DOTENV_OVERRIDE flag", async () => {
    process.env.SHIPSPEC_DOTENV_OVERRIDE = "1";
    await loadConfig();
    expect(loadDotenv).toHaveBeenCalledWith(
      expect.objectContaining({
        override: true,
      })
    );
  });
});
