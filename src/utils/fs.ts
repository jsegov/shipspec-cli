import { readFile, stat } from "fs/promises";
import { extname } from "path";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".go",
  ".rs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".sql",
  ".toml",
]);

export async function readSourceFile(filepath: string): Promise<string> {
  return readFile(filepath, "utf-8");
}

export function isSourceFile(filepath: string): boolean {
  const ext = extname(filepath).toLowerCase();
  return SOURCE_EXTENSIONS.has(ext);
}

export async function getFileSize(filepath: string): Promise<number> {
  const stats = await stat(filepath);
  return stats.size;
}

export async function fileExists(filepath: string): Promise<boolean> {
  try {
    const stats = await stat(filepath);
    return stats.isFile();
  } catch {
    return false;
  }
}

export function getRelativePath(filepath: string, basePath: string): string {
  const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
  if (filepath === basePath) {
    return "";
  }
  if (filepath.startsWith(normalizedBase)) {
    return filepath.slice(normalizedBase.length);
  }
  return filepath;
}
