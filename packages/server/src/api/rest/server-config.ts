import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "@matrix/protocol";
import { getDataDir, getSrvDir } from "../../data-dir.js";

function resolveConfigDir(): string {
  return path.join(getDataDir(), ".matrix");
}

function resolveDefaultConfig(): ServerConfig {
  const srvDir = getSrvDir();
  return {
    reposPath: path.join(srvDir, "repos"),
    worktreesPath: path.join(srvDir, "worktrees"),
    defaultAgent: undefined,
  };
}

function readServerConfig(): ServerConfig {
  const configFile = path.join(resolveConfigDir(), "server-config.json");
  const defaults = resolveDefaultConfig();
  try {
    const raw = fs.readFileSync(configFile, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

function writeServerConfig(config: ServerConfig): void {
  const configDir = resolveConfigDir();
  const configFile = path.join(configDir, "server-config.json");
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", {
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
    const srvDir = getSrvDir();
    updated.reposPath = updated.reposPath.replace(/^~/, srvDir);
    updated.worktreesPath = updated.worktreesPath.replace(/^~/, srvDir);

    writeServerConfig(updated);
    return c.json(updated);
  });

  return app;
}
