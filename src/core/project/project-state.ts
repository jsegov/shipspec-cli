import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, resolve } from "path";
import { existsSync } from "fs";

export const PROJECT_DIR = ".ship-spec";
export const PROJECT_FILE = "project.json";
export const OUTPUTS_DIR = "outputs";

// Schema definition
export const ProjectStateSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  initializedAt: z.string(),
  updatedAt: z.string(),
  projectRoot: z.string(),
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;

// Read project state from a directory
export async function readProjectState(projectRoot: string): Promise<ProjectState | null> {
  const filePath = join(projectRoot, PROJECT_DIR, PROJECT_FILE);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = await readFile(filePath, "utf-8");
    return ProjectStateSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

// Write project state to a directory
export async function writeProjectState(projectRoot: string, state: ProjectState): Promise<void> {
  const dirPath = join(projectRoot, PROJECT_DIR);
  const filePath = join(dirPath, PROJECT_FILE);
  
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
  
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

// Find initialized project root by walking up from startDir
export function findProjectRoot(startDir: string): string | null {
  let currentDir = resolve(startDir);
  
  while (currentDir !== dirname(currentDir)) {
    const projectFilePath = join(currentDir, PROJECT_DIR, PROJECT_FILE);
    if (existsSync(projectFilePath)) {
      return currentDir;
    }
    
    currentDir = dirname(currentDir);
  }
  
  // Check the root directory as well
  const rootProjectFilePath = join(currentDir, PROJECT_DIR, PROJECT_FILE);
  if (existsSync(rootProjectFilePath)) {
    return currentDir;
  }
  
  return null;
}

// Check if a directory is initialized
export function isInitialized(dir: string): boolean {
  const projectRoot = findProjectRoot(dir);
  return projectRoot !== null;
}
