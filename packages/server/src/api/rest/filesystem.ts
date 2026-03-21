import { Hono } from "hono";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSrvDir } from "../../data-dir.js";

export function filesystemRoutes(opts?: { localMode?: boolean }) {
  const app = new Hono();
  const localMode = opts?.localMode ?? false;

  app.get("/fs/list", async (c) => {
    const rawPath = c.req.query("path");
    const homeDir = os.homedir();
    const defaultRoot = localMode ? homeDir : getSrvDir();
    const dirPath = path.resolve(
      rawPath ? rawPath.replace(/^~/, homeDir) : defaultRoot,
    );

    let realDirPath: string;
    try {
      realDirPath = await fs.realpath(dirPath);
    } catch {
      return c.json({ error: "Path does not exist" }, 404);
    }

    // Path containment: only enforce on remote servers
    if (!localMode) {
      let realDefaultRoot: string;
      try {
        realDefaultRoot = await fs.realpath(defaultRoot);
      } catch {
        return c.json({ error: "Browse root does not exist" }, 500);
      }
      if (!realDirPath.startsWith(realDefaultRoot + path.sep) && realDirPath !== realDefaultRoot) {
        return c.json({ error: `Path must be within ${defaultRoot}` }, 403);
      }
    }

    let stat;
    try {
      stat = await fs.stat(realDirPath);
    } catch {
      return c.json({ error: "Path does not exist" }, 404);
    }

    if (!stat.isDirectory()) {
      return c.json({ error: "Path is not a directory" }, 400);
    }

    let dirents;
    try {
      dirents = await fs.readdir(realDirPath, { withFileTypes: true });
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
