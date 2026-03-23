import pino from "pino";
// @ts-expect-error pino-roll has no type declarations
import pinoRoll from "pino-roll";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const isLocal = process.env.MATRIX_LOCAL === "true";
const defaultLevel = process.env.NODE_ENV === "production" ? "info" : "debug";
const level = process.env.MATRIX_LOG_LEVEL || defaultLevel;

async function createLogger(): Promise<pino.Logger> {
  // Sidecar mode: JSON to stdout, Rust captures and forwards to tauri-plugin-log
  if (isLocal) {
    return pino({ level });
  }

  // Standalone mode (Linux): write to ~/.matrix/logs/ via pino-roll
  // Uses direct import instead of pino.transport() to work in Bun compiled binaries
  const logDir = join(homedir(), ".matrix", "logs");
  mkdirSync(logDir, { recursive: true });

  const stream = await pinoRoll({
    file: join(logDir, "matrix.log"),
    size: "10m",
    limit: { count: 5 },
    mkdir: true,
  });

  return pino({ level }, stream);
}

export const logger = await createLogger();
