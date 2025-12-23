import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readProjectState,
  writeProjectState,
  findProjectRoot,
} from "../../../core/project/project-state.js";
import { createTempDir, cleanupTempDir } from "../../fixtures.js";
import { join } from "path";
import { mkdir } from "fs/promises";
import { randomUUID } from "crypto";

describe("ProjectState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("should write and read project state", async () => {
    const state = {
      schemaVersion: 1 as const,
      projectId: randomUUID(),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot: tempDir,
    };

    await writeProjectState(tempDir, state);
    const readState = await readProjectState(tempDir);

    expect(readState).toEqual(state);
  });

  it("should find project root by walking up", async () => {
    const subDir = join(tempDir, "a", "b", "c");
    await mkdir(subDir, { recursive: true });

    const state = {
      schemaVersion: 1 as const,
      projectId: randomUUID(),
      initializedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot: tempDir,
    };

    await writeProjectState(tempDir, state);

    const foundRoot = findProjectRoot(subDir);
    expect(foundRoot).toBe(tempDir);
  });

  it("should return null if no project root is found", () => {
    const foundRoot = findProjectRoot(tempDir);
    expect(foundRoot).toBeNull();
  });
});
