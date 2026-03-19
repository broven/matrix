import { $ } from "bun";
import { nanoid } from "nanoid";
import path from "node:path";
import type { CloneJobInfo, CloneJobStatus } from "@matrix/protocol";

interface CloneJob {
  jobId: string;
  status: CloneJobStatus;
  url: string;
  targetDir: string;
  repositoryId?: string;
  error?: string;
}

export class CloneManager {
  private jobs = new Map<string, CloneJob>();

  /**
   * Start a clone operation in the background.
   * Returns immediately with a job ID.
   */
  startClone(
    url: string,
    targetDir: string,
    branch?: string,
    onComplete?: (job: CloneJob) => void | Promise<void>,
  ): string {
    const jobId = `clone_${nanoid()}`;
    const job: CloneJob = {
      jobId,
      status: "cloning",
      url,
      targetDir,
    };
    this.jobs.set(jobId, job);

    // Run clone in background
    this.runClone(job, branch, onComplete);

    return jobId;
  }

  getJob(jobId: string): CloneJobInfo | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { ...job };
  }

  listJobs(): CloneJobInfo[] {
    return Array.from(this.jobs.values()).map((j) => ({ ...j }));
  }

  private async runClone(
    job: CloneJob,
    branch?: string,
    onComplete?: (job: CloneJob) => void | Promise<void>,
  ): Promise<void> {
    try {
      const args = ["git", "clone"];
      if (branch) {
        args.push("--branch", branch);
      }
      args.push(job.url, job.targetDir);

      const result = await $`${args}`.quiet();
      if (result.exitCode !== 0) {
        job.status = "failed";
        job.error = result.stderr.toString().trim() || "Clone failed";
      } else {
        // Don't mark completed yet — let onComplete (e.g. auto-registration) finish first
        if (onComplete) {
          try {
            await onComplete(job);
          } catch (e) {
            console.error(`[clone] onComplete callback failed:`, e);
          }
        }
        job.status = "completed";
        return;
      }
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "Clone failed";
    }

    if (onComplete) {
      try {
        await onComplete(job);
      } catch (e) {
        console.error(`[clone] onComplete callback failed:`, e);
      }
    }
  }

  /**
   * Parse a repo name from a git URL.
   */
  static parseRepoName(url: string): string {
    // Handle SSH: git@github.com:user/repo.git
    // Handle HTTPS: https://github.com/user/repo.git
    const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");
    const parts = cleaned.split(/[/:]/);
    const name = parts[parts.length - 1] || "repo";
    // Sanitize: strip path-traversal sequences and invalid chars
    const safe = name.replace(/\.\./g, "").replace(/[/\\]/g, "");
    return safe || "repo";
  }
}
