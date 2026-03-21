import { $ } from "bun";
import path from "node:path";

interface WorktreeListEntry {
  branch: string;
  path: string;
  head: string;
  isBare: boolean;
}

export class WorktreeManager {
  private wtPath: string | false | null = null; // null=unchecked, false=not found

  /**
   * Resolve the `wt` binary path.
   * Priority: bundled binary → PATH → not found (git fallback).
   */
  private async resolveWt(): Promise<string | null> {
    if (this.wtPath !== null) return this.wtPath || null;

    // 1. Bundled binary at packages/server/bin/wt
    const bundled = path.join(import.meta.dir, "../../bin/wt");
    try {
      if (await Bun.file(bundled).exists()) {
        this.wtPath = bundled;
        return bundled;
      }
    } catch { /* fall through */ }

    // 2. PATH
    try {
      const result = await $`which wt`.quiet();
      if (result.exitCode === 0) {
        this.wtPath = result.stdout.toString().trim();
        return this.wtPath;
      }
    } catch { /* fall through */ }

    this.wtPath = false;
    return null;
  }

  /**
   * Create a worktree for a branch. Returns the worktree path.
   */
  async createWorktree(
    repoPath: string,
    branch: string,
    baseBranch: string,
  ): Promise<string> {
    const wt = await this.resolveWt();
    if (wt) {
      return this.createWithWt(wt, repoPath, branch, baseBranch);
    }
    return this.createWithGit(repoPath, branch, baseBranch);
  }

  /**
   * List worktrees for a repository.
   */
  async listWorktrees(repoPath: string): Promise<WorktreeListEntry[]> {
    const result = await $`git -C ${repoPath} worktree list --porcelain`.quiet().nothrow();
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list worktrees: ${result.stderr.toString()}`);
    }

    const output = result.stdout.toString();
    const entries: WorktreeListEntry[] = [];
    let current: Partial<WorktreeListEntry> = {};

    for (const line of output.split("\n")) {
      if (line === "") {
        if (current.path) {
          entries.push(current as WorktreeListEntry);
        }
        current = {};
        continue;
      }
      if (line.startsWith("worktree ")) {
        current.path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        // refs/heads/branch-name → branch-name
        current.branch = line.slice("branch ".length).replace("refs/heads/", "");
      } else if (line === "bare") {
        current.isBare = true;
      }
    }
    if (current.path) {
      entries.push(current as WorktreeListEntry);
    }

    return entries;
  }

  /**
   * Remove a worktree by branch name or path.
   */
  async removeWorktree(repoPath: string, branch: string): Promise<void> {
    const wt = await this.resolveWt();
    if (wt) {
      await this.removeWithWt(wt, repoPath, branch);
    } else {
      await this.removeWithGit(repoPath, branch);
    }
  }

  /**
   * Detect the default branch of a repository.
   */
  async detectDefaultBranch(repoPath: string): Promise<string> {
    // Try symbolic-ref for origin/HEAD
    try {
      const result = await $`git -C ${repoPath} symbolic-ref refs/remotes/origin/HEAD`.quiet();
      if (result.exitCode === 0) {
        const ref = result.stdout.toString().trim();
        return ref.replace("refs/remotes/origin/", "");
      }
    } catch { /* fall through */ }

    // Fallback: check for main or master
    try {
      const result = await $`git -C ${repoPath} rev-parse --verify main`.quiet();
      if (result.exitCode === 0) return "main";
    } catch { /* fall through */ }

    try {
      const result = await $`git -C ${repoPath} rev-parse --verify master`.quiet();
      if (result.exitCode === 0) return "master";
    } catch { /* fall through */ }

    return "main";
  }

  /**
   * Validate that a path is a git repository.
   */
  async validateGitRepo(repoPath: string): Promise<boolean> {
    try {
      const result = await $`git -C ${repoPath} rev-parse --git-dir`.quiet();
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  // ── wt-based implementations ──────────────────────────────────────

  private async createWithWt(wt: string, repoPath: string, branch: string, baseBranch: string): Promise<string> {
    const result = await $`${wt} switch -c ${branch} --base ${baseBranch} --yes`.cwd(repoPath).quiet();
    if (result.exitCode !== 0) {
      throw new Error(`wt switch failed: ${result.stderr.toString()}`);
    }

    // wt creates worktrees at a sibling directory; find the new worktree path
    const worktreePath = await this.findWorktreePath(repoPath, branch);
    if (!worktreePath) {
      throw new Error(`Worktree created but path not found for branch: ${branch}`);
    }
    return worktreePath;
  }

  private async removeWithWt(wt: string, repoPath: string, branch: string): Promise<void> {
    const result = await $`${wt} remove ${branch} --yes`.cwd(repoPath).quiet().nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      console.error(`[worktree] wt remove failed (exit ${result.exitCode}): ${stderr}`);
      throw new Error(`wt remove failed: ${stderr}`);
    }
  }

  // ── git-based fallback implementations ────────────────────────────

  private async createWithGit(repoPath: string, branch: string, baseBranch: string): Promise<string> {
    // Compute worktree path: sibling directory named after branch
    const parentDir = path.dirname(repoPath);
    const repoName = path.basename(repoPath);
    const safeBranch = branch.replace(/\//g, "-");
    const worktreePath = path.join(parentDir, `${repoName}-${safeBranch}`);

    const result = await $`git -C ${repoPath} worktree add -b ${branch} ${worktreePath} ${baseBranch}`.quiet();
    if (result.exitCode !== 0) {
      throw new Error(`git worktree add failed: ${result.stderr.toString()}`);
    }
    return worktreePath;
  }

  private async removeWithGit(repoPath: string, branch: string): Promise<void> {
    // Find the worktree path for this branch
    const worktreePath = await this.findWorktreePath(repoPath, branch);
    if (!worktreePath) {
      throw new Error(`No worktree found for branch: ${branch}`);
    }

    // Use non-force removal so uncommitted changes are not silently discarded
    const result = await $`git -C ${repoPath} worktree remove ${worktreePath}`.quiet().nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      console.error(`[worktree] git worktree remove failed (exit ${result.exitCode}): ${stderr}`);
      throw new Error(`git worktree remove failed: ${stderr}`);
    }

    // Use -d (not -D) so unmerged branches are not silently deleted
    const branchResult = await $`git -C ${repoPath} branch -d ${branch}`.quiet().nothrow();
    if (branchResult.exitCode !== 0) {
      console.warn(`[worktree] Branch deletion failed (branch may not be fully merged): ${branchResult.stderr.toString().trim()}`);
    }
  }

  private async findWorktreePath(repoPath: string, branch: string): Promise<string | null> {
    const entries = await this.listWorktrees(repoPath);
    const entry = entries.find((e) => e.branch === branch);
    return entry?.path ?? null;
  }
}
