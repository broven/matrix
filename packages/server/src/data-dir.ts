import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger.js";

const log = logger.child({ target: "data-dir" });

/**
 * Return the data directory for DB and config storage.
 *
 * - Server deployment: MATRIX_DATA_DIR env var (set by install script)
 * - Desktop (local mode): os.homedir()
 */
export function getDataDir(): string {
  return process.env.MATRIX_DATA_DIR || os.homedir();
}

/**
 * Return the service directory for user content (repos, worktrees).
 *
 * - Server deployment: MATRIX_SRV_DIR env var (default /srv/matrix)
 * - Desktop (local mode): ~/MatrixProjects
 */
export function getSrvDir(): string {
  if (process.env.MATRIX_SRV_DIR) return process.env.MATRIX_SRV_DIR;
  return path.join(os.homedir(), "MatrixProjects");
}

/**
 * Validate the data directory is accessible and writable.
 * Call at server startup — exits with guidance if dir is inaccessible.
 */
export function validateDataDir(): void {
  const dir = getDataDir();
  const source = process.env.MATRIX_DATA_DIR ? "MATRIX_DATA_DIR" : "os.homedir()";

  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    log.error({ dir, source }, "data directory not accessible");
    log.error("set MATRIX_DATA_DIR in your config to a writable directory");
    if (source !== "MATRIX_DATA_DIR") {
      log.error("hint: export MATRIX_DATA_DIR=/var/lib/matrix");
    }
    process.exit(1);
  }
}
