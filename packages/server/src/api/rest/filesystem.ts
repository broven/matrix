import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "../../data-dir.js";

export function filesystemRoutes() {
  const app = new Hono();

  app.get("/fs/list", async (c) => {
    const rawPath = c.req.query("path");
    const browseRoot = getDataDir();
    const dirPath = path.resolve(
      rawPath ? rawPath.replace(/^~/, browseRoot) : browseRoot,
    );

    // Resolve symlinks before containment check to prevent symlink escape
    let realDirPath: string;
    let realBrowseRoot: string;
    try {
      realBrowseRoot = await fs.realpath(browseRoot);
    } catch {
      return c.json({ error: "Browse root does not exist" }, 500);
    }
    try {
      realDirPath = await fs.realpath(dirPath);
    } catch {
      return c.json({ error: "Path does not exist" }, 404);
    }

    // Path containment: must be within browse root (using resolved paths)
    if (!realDirPath.startsWith(realBrowseRoot + path.sep) && realDirPath !== realBrowseRoot) {
      return c.json({ error: `Path must be within ${browseRoot}` }, 403);
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
