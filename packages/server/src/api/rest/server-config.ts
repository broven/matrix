import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ServerConfig } from "@matrix/protocol";

const CONFIG_DIR = path.join(os.homedir(), ".matrix");
const SERVER_CONFIG_FILE = path.join(CONFIG_DIR, "server-config.json");

const DEFAULT_CONFIG: ServerConfig = {
  reposPath: path.join(os.homedir(), "Projects", "repos"),
  worktreesPath: path.join(os.homedir(), "Projects", "worktrees"),
  defaultAgent: undefined,
};

function readServerConfig(): ServerConfig {
  try {
    const raw = fs.readFileSync(SERVER_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeServerConfig(config: ServerConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SERVER_CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function getServerConfig(): ServerConfig {
  return readServerConfig();
}

export function serverConfigRoutes() {
  const app = new Hono();

  app.get("/server/config", (c) => {
    return c.json(readServerConfig());
  });

  app.put("/server/config", async (c) => {
    const body = await c.req.json<Partial<ServerConfig>>();
    const current = readServerConfig();

    const updated: ServerConfig = {
      reposPath: body.reposPath ?? current.reposPath,
      worktreesPath: body.worktreesPath ?? current.worktreesPath,
      defaultAgent: body.defaultAgent !== undefined ? body.defaultAgent : current.defaultAgent,
    };

    // Expand ~ in paths
    updated.reposPath = updated.reposPath.replace(/^~/, os.homedir());
    updated.worktreesPath = updated.worktreesPath.replace(/^~/, os.homedir());

    writeServerConfig(updated);
    return c.json(updated);
  });

  return app;
}
