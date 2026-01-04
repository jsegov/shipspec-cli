import { describe, it, expect, afterEach } from "vitest";

import { resolveProjectRoot, applyProjectPaths } from "../../flows/shared.js";
import type { ShipSpecConfig } from "../../config/schema.js";

describe("resolveProjectRoot", () => {
  const originalEnv = process.env.SHIPSPEC_PROJECT_ROOT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SHIPSPEC_PROJECT_ROOT;
    } else {
      process.env.SHIPSPEC_PROJECT_ROOT = originalEnv;
    }
  });

  it("should return trimmed path when env var has leading/trailing whitespace", () => {
    process.env.SHIPSPEC_PROJECT_ROOT = "  /path/to/project  ";
    const result = resolveProjectRoot();
    expect(result).toBe("/path/to/project");
  });

  it("should return path unchanged when env var has no whitespace", () => {
    process.env.SHIPSPEC_PROJECT_ROOT = "/clean/path";
    const result = resolveProjectRoot();
    expect(result).toBe("/clean/path");
  });

  it("should fall back to findProjectRoot when env var is only whitespace", () => {
    process.env.SHIPSPEC_PROJECT_ROOT = "   ";
    // This will throw because no project root is found in test environment
    expect(() => resolveProjectRoot("/nonexistent")).toThrow();
  });

  it("should fall back to findProjectRoot when env var is empty string", () => {
    process.env.SHIPSPEC_PROJECT_ROOT = "";
    expect(() => resolveProjectRoot("/nonexistent")).toThrow();
  });
});

describe("applyProjectPaths", () => {
  it("should set projectPath and vectorDbPath correctly", () => {
    const config = {} as ShipSpecConfig;
    const result = applyProjectPaths(config, "/my/project");

    expect(result.projectPath).toBe("/my/project");
    expect(result.vectorDbPath).toBe("/my/project/.ship-spec/lancedb");
  });

  it("should not produce paths with leading whitespace", () => {
    const config = {} as ShipSpecConfig;
    // Simulate a trimmed path (as resolveProjectRoot now returns)
    const result = applyProjectPaths(config, "/my/project");

    expect(result.projectPath).not.toMatch(/^\s/);
    expect(result.vectorDbPath).not.toMatch(/^\s/);
  });
});
