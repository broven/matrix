import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateToken } from "./auth/token.js";

const CONFIG_DIR = path.join(os.homedir(), ".matrix");
const CONFIG_FILE = path.join(CONFIG_DIR, "server.json");

interface PersistedConfig {
  token: string;
}

function readConfig(): PersistedConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as PersistedConfig;
  } catch {
    return null;
  }
}

function writeConfig(config: PersistedConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Returns a persistent token. On first call, generates and saves a new token.
 * On subsequent calls, returns the saved token.
 */
export function getPersistedToken(): string {
  const existing = readConfig();
  if (existing?.token) {
    return existing.token;
  }

  const token = generateToken();
  writeConfig({ token });
  return token;
}
