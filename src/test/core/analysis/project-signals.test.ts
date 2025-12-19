import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { gatherProjectSignals } from "../../../core/analysis/project-signals.js";

describe("Project Signals Scanner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("should detect npm package manager and github actions", async () => {
    await writeFile(join(tempDir, "package-lock.json"), "{}");
    await mkdir(join(tempDir, ".github/workflows"), { recursive: true });
    await writeFile(join(tempDir, ".github/workflows/main.yml"), "");
    await writeFile(join(tempDir, "index.ts"), "console.log('hello')");

    const signals = await gatherProjectSignals(tempDir);

    expect(signals.packageManager).toBe("npm");
    expect(signals.hasCI).toBe(true);
    expect(signals.ciPlatform).toBe("github");
    expect(signals.detectedLanguages).toContain("typescript");
  });

  it("should detect tests and docker", async () => {
    await writeFile(join(tempDir, "Dockerfile"), "FROM node:20");
    await writeFile(join(tempDir, "vitest.config.ts"), "");
    await mkdir(join(tempDir, "src/test"), { recursive: true });
    await writeFile(join(tempDir, "src/test/app.test.ts"), "");

    const signals = await gatherProjectSignals(tempDir);

    expect(signals.hasDocker).toBe(true);
    expect(signals.hasTests).toBe(true);
    expect(signals.testFramework).toBe("vitest");
  });

  it("should detect terraform and security policies", async () => {
    await writeFile(join(tempDir, "main.tf"), "");
    await writeFile(join(tempDir, "SECURITY.md"), "");
    await writeFile(join(tempDir, ".env.example"), "");

    const signals = await gatherProjectSignals(tempDir);

    expect(signals.hasIaC).toBe(true);
    expect(signals.iacTool).toBe("terraform");
    expect(signals.hasSecurityPolicy).toBe(true);
    expect(signals.hasEnvExample).toBe(true);
  });

  it("should detect multiple languages", async () => {
    await writeFile(join(tempDir, "app.py"), "print('hi')");
    await writeFile(join(tempDir, "main.go"), "package main");
    await writeFile(join(tempDir, "lib.rs"), "fn main() {}");

    const signals = await gatherProjectSignals(tempDir);

    expect(signals.detectedLanguages).toContain("python");
    expect(signals.detectedLanguages).toContain("go");
    expect(signals.detectedLanguages).toContain("rust");
  });
});
