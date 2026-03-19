import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export function filesystemRoutes() {
  const app = new Hono();

  app.get("/fs/list", async (c) => {
    const rawPath = c.req.query("path");
    const dirPath = path.resolve(
      rawPath ? rawPath.replace(/^~/, os.homedir()) : os.homedir(),
    );

    // Path containment: must be within home directory
    const home = os.homedir();
    if (!dirPath.startsWith(home + path.sep) && dirPath !== home) {
      return c.json({ error: "Path must be within the home directory" }, 403);
    }

    let stat;
    try {
      stat = await fs.stat(dirPath);
    } catch {
      return c.json({ error: "Path does not exist" }, 404);
    }

    if (!stat.isDirectory()) {
      return c.json({ error: "Path is not a directory" }, 400);
    }

    let dirents;
    try {
      dirents = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read directory";
      return c.json({ error: message }, 403);
    }

    const entries: Array<{
      name: string;
      path: string;
      isDir: boolean;
      isGitRepo: boolean;
    }> = [];

    for (const dirent of dirents) {
      // Skip hidden files/directories
      if (dirent.name.startsWith(".")) continue;

      if (!dirent.isDirectory()) continue;

      const fullPath = path.join(dirPath, dirent.name);
      let isGitRepo = false;
      try {
        await fs.access(path.join(fullPath, ".git"));
        isGitRepo = true;
      } catch {
        // not a git repo
      }

      entries.push({
        name: dirent.name,
        path: fullPath,
        isDir: true,
        isGitRepo,
      });
    }

    // Sort: git repos first, then alphabetical
    entries.sort((a, b) => {
      if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return c.json({ entries });
  });

  return app;
}
