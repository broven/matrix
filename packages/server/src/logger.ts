import pino from "pino";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const isLocal = process.env.MATRIX_LOCAL === "true";
const defaultLevel = process.env.NODE_ENV === "production" ? "info" : "debug";
const level = process.env.MATRIX_LOG_LEVEL || defaultLevel;

function createLogger(): pino.Logger {
  // Sidecar mode: JSON to stdout, Rust captures and forwards to tauri-plugin-log
  if (isLocal) {
    return pino({ level });
  }

  // Standalone mode (Linux): write to ~/.matrix/logs/ via pino-roll
  const logDir = join(homedir(), ".matrix", "logs");
  mkdirSync(logDir, { recursive: true });

  return pino(
    { level },
    pino.transport({
      target: "pino-roll",
      options: {
        file: join(logDir, "matrix.log"),
        size: "10m",
        limit: { count: 5 },
        mkdir: true,
      },
    }),
  );
}

export const logger = createLogger();
