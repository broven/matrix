import { $ } from "bun";
import { nanoid } from "nanoid";
import path from "node:path";
import { parseRepoName } from "@matrix/protocol";
import type { CloneJobInfo, CloneJobStatus } from "@matrix/protocol";
import { logger } from "../logger.js";

const log = logger.child({ target: "clone" });

interface CloneJob {
  jobId: string;
  status: CloneJobStatus;
  url: string;
  targetDir: string;
  repositoryId?: string;
  error?: string;
  completedAt?: number;
}

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

export class CloneManager {
  private jobs = new Map<string, CloneJob>();

  /**
   * Start a clone operation in the background.
   * Returns immediately with a job ID.
   */
  private static readonly ALLOWED_URL = /^(https?:\/\/|git:\/\/|git@)/;
  private static readonly SAFE_BRANCH = /^[a-zA-Z0-9._\-/]+$/;

  startClone(
    url: string,
    targetDir: string,
    branch?: string,
    onComplete?: (job: CloneJob) => void | Promise<void>,
  ): string {
    if (!CloneManager.ALLOWED_URL.test(url)) {
      throw new Error("URL must use https://, http://, git://, or git@ protocol");
    }
    if (branch && !CloneManager.SAFE_BRANCH.test(branch)) {
      throw new Error("Invalid branch name");
    }

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
    this.sweepExpired();
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { ...job };
  }

  listJobs(): CloneJobInfo[] {
    this.sweepExpired();
    return Array.from(this.jobs.values()).map((j) => ({ ...j }));
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
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
        job.completedAt = Date.now();
      } else {
        // Don't mark completed yet — let onComplete (e.g. auto-registration) finish first
        if (onComplete) {
          try {
            await onComplete(job);
          } catch (e) {
            log.error({ err: e }, "onComplete callback failed");
          }
        }
        job.status = "completed";
        job.completedAt = Date.now();
        return;
      }
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "Clone failed";
      job.completedAt = Date.now();
    }

    if (onComplete) {
      try {
        await onComplete(job);
      } catch (e) {
        log.error({ err: e }, "onComplete callback failed");
      }
    }
  }

  static parseRepoName = parseRepoName;
}
