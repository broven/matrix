import { spawn, type ChildProcess } from "node:child_process";
import type { AgentConfig, AgentListItem } from "@matrix/protocol";
import { isAgentAvailable } from "./config.js";

export interface AgentHandle {
  agentId: string;
  process: ChildProcess;
  cwd: string;
}

export class AgentManager {
  private configs = new Map<string, AgentConfig>();

  register(config: AgentConfig): void {
    this.configs.set(config.id, config);
  }

  listAgents(): AgentListItem[] {
    return Array.from(this.configs.values()).map((config) => ({
      id: config.id,
      name: config.name,
      command: config.command,
      available: isAgentAvailable(config),
    }));
  }

  spawn(agentId: string, cwd: string): AgentHandle {
    const config = this.configs.get(agentId);
    if (!config) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const child = spawn(config.command, config.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...config.env },
    });

    return {
      agentId,
      process: child,
      cwd,
    };
  }

  getConfig(agentId: string): AgentConfig | undefined {
    return this.configs.get(agentId);
  }
}
