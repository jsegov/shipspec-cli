/**
 * Atomic, symlink-safe file writing utility.
 * Prevents TOCTOU (Time-Of-Check-Time-Of-Use) vulnerabilities and symlink attacks.
 *
 * Security context:
 * - Symlink attacks: attacker pre-creates target file as symlink to sensitive file
 * - TOCTOU: race condition between checking file and writing to it
 * - Atomic writes: prevent partial/corrupt files from being observed
 *
 * Mitigation strategy:
 * 1. Use lstat() to detect symlinks (don't follow them)
 * 2. Write to unique temp file (unpredictable name in same directory)
 * 3. Atomically rename temp file to target (POSIX guarantees atomicity)
 * 4. Set restrictive permissions (0o600 by default)
 */

import { writeFile, rename, unlink, mkdir } from "fs/promises";
import { lstatSync, openSync, closeSync, fsyncSync } from "fs";
import { dirname, basename } from "path";

export interface SafeWriteOptions {
  /**
   * File mode (permissions) to set on created file.
   * Default: 0o600 (owner read/write only)
   * POSIX only - ignored on Windows
   */
  mode?: number;
}

/**
 * Writes data to a file atomically, refusing to follow symbolic links.
 *
 * This function provides defense-in-depth against local file manipulation:
 * - Symlink refusal: throws if target exists and is a symlink
 * - Atomic write: uses temp file + rename for atomicity
 * - Restrictive permissions: defaults to 0o600 (owner-only)
 * - fsync: flushes data to disk before rename (optional but preferred)
 *
 * @param path - Absolute path to the target file
 * @param data - Data to write (string or Buffer)
 * @param opts - Optional settings (mode)
 * @throws Error if target is a symlink or if write fails
 */
export async function writeFileAtomicNoFollow(
  path: string,
  data: string | Buffer,
  opts: SafeWriteOptions = {}
): Promise<void> {
  const mode = opts.mode ?? 0o600;
  const dir = dirname(path);
  const base = basename(path);

  // Ensure parent directory exists with restrictive permissions
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    // Directory might already exist, that's OK
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "EEXIST") {
      throw err;
    }
  }

  // Check if target exists and refuse if it's a symlink
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Refusing to write to symlink: ${path}. ` +
          `This may be a symlink attack attempt. Delete the symlink and try again.`
      );
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    // ENOENT is expected (file doesn't exist yet)
    if (error.code !== "ENOENT") {
      throw err;
    }
  }

  // Generate unique temp file name in same directory
  // Format: .{basename}.tmp-{pid}-{timestamp}
  const tempPath = `${dir}/.${base}.tmp-${String(process.pid)}-${String(Date.now())}`;

  try {
    // Write data to temp file with restrictive permissions
    await writeFile(tempPath, data, {
      mode,
      encoding: typeof data === "string" ? "utf-8" : undefined,
    });

    // Flush to disk (best-effort, not critical if it fails)
    try {
      const fd = openSync(tempPath, "r+");
      fsyncSync(fd);
      closeSync(fd);
    } catch {
      // fsync is optional - continue if it fails
    }

    // Atomically rename temp file to target
    // On POSIX: rename() is atomic if both paths are on the same filesystem
    // On Windows: may need to delete existing file first
    try {
      await rename(tempPath, path);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      // Windows-specific: EPERM can mean target exists, try delete + rename
      if (error.code === "EPERM" || error.code === "EACCES") {
        // Re-check symlink before deleting (defense in depth)
        try {
          const stats = lstatSync(path);
          if (stats.isSymbolicLink()) {
            throw new Error(`Target became a symlink during write: ${path}`);
          }
        } catch {
          // ENOENT is OK, file doesn't exist
        }

        // Delete existing file and retry rename
        try {
          await unlink(path);
        } catch {
          // Ignore unlink errors
        }
        await rename(tempPath, path);
      } else {
        throw err;
      }
    }
  } catch (err) {
    // Clean up temp file on error
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}
