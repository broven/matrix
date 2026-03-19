import type { AvailableCommand } from "@matrix/protocol";

export class CommandCache {
  private cache = new Map<string, AvailableCommand[]>();

  private key(worktreeId: string, agentId: string): string {
    return `${worktreeId}:${agentId}`;
  }

  set(worktreeId: string, agentId: string, commands: AvailableCommand[]): void {
    this.cache.set(this.key(worktreeId, agentId), commands);
  }

  get(worktreeId: string, agentId: string): AvailableCommand[] | undefined {
    return this.cache.get(this.key(worktreeId, agentId));
  }

  delete(worktreeId: string, agentId: string): void {
    this.cache.delete(this.key(worktreeId, agentId));
  }
}
