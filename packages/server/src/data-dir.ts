import fs from "node:fs";
import os from "node:os";

/**
 * Return the data directory for config/state storage.
 *
 * - Server deployment: MATRIX_DATA_DIR env var (required, set by install script)
 * - Desktop (local mode): os.homedir()
 *
 * No fallback — if MATRIX_DATA_DIR is set but invalid, the server
 * should fail loudly at startup via `validateDataDir()`.
 */
export function getDataDir(): string {
  return process.env.MATRIX_DATA_DIR || os.homedir();
}

/**
 * Validate the data directory is accessible and writable.
 * Call at server startup — logs warnings so the operator can fix config.
 */
export function validateDataDir(): void {
  const dir = getDataDir();
  const source = process.env.MATRIX_DATA_DIR ? "MATRIX_DATA_DIR" : "os.homedir()";

  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    console.error(
      `[matrix-server] ERROR: Data directory not accessible: ${dir} (from ${source})`,
    );
    console.error(
      `[matrix-server] Set MATRIX_DATA_DIR in your config to a writable directory`,
    );
    if (source !== "MATRIX_DATA_DIR") {
      console.error(
        `[matrix-server] Hint: export MATRIX_DATA_DIR=/var/lib/matrix`,
      );
    }
    process.exit(1);
  }
}
