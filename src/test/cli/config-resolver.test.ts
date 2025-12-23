import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";

import { resolveCliConfig } from "../../cli/config-resolver.js";
import { createTempDir, cleanupTempDir } from "../fixtures.js";
import { writeProjectState } from "../../core/project/project-state.js";

describe("resolveCliConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("uses project root when running from a subdirectory", async () => {
    const projectRoot = join(tempDir, "project");
    await mkdir(projectRoot, { recursive: true });

    await writeProjectState(projectRoot, {
      schemaVersion: 1,
      projectId: randomUUID(),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot,
    });

    const configPath = join(projectRoot, "shipspec.json");
    await writeFile(
      configPath,
      JSON.stringify({ ignorePatterns: ["**/custom-ignore/**"] }, null, 2),
      "utf-8"
    );

    const subDir = join(projectRoot, "nested", "deep");
    await mkdir(subDir, { recursive: true });

    const config = await resolveCliConfig({ actionName: "productionalize", cwd: subDir });

    expect(config.ignorePatterns).toContain("**/custom-ignore/**");
  });

  it("resolves explicit config path relative to the original cwd", async () => {
    const projectRoot = join(tempDir, "project");
    const nestedDir = join(projectRoot, "nested");
    await mkdir(nestedDir, { recursive: true });

    await writeProjectState(projectRoot, {
      schemaVersion: 1,
      projectId: randomUUID(),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot,
    });

    const configContent = { ignorePatterns: ["**/from-relative-config/**"] };
    const configPath = join(projectRoot, "shipspec.json");
    await writeFile(configPath, JSON.stringify(configContent, null, 2), "utf-8");

    const config = await resolveCliConfig({
      actionName: "productionalize",
      cwd: nestedDir,
      configPath: "../shipspec.json",
    });

    expect(config.ignorePatterns).toContain("**/from-relative-config/**");
  });
});
