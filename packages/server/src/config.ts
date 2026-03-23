import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  webDir: string | null;
  localMode: boolean;
}

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function getDefaultDbPath(localMode: boolean): string {
  if (!localMode) return "./matrix.db";
  const dataDir = path.join(homedir(), "Library", "Application Support", "com.matrix.client");
  mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "matrix.db");
}

export function loadConfig(): ServerConfig {
  const args = parseArgs();
  const localMode = args.local === "true" || process.env.MATRIX_LOCAL === "true" || false;
  return {
    port: parseInt(args.port || process.env.PORT || process.env.MATRIX_PORT || "8080", 10),
    host: args.host || process.env.MATRIX_HOST || "0.0.0.0",
    dbPath: args.db || process.env.MATRIX_DB_PATH || getDefaultDbPath(localMode),
    webDir: args.web || process.env.MATRIX_WEB_DIR || null,
    localMode,
  };
}
