import { spawn, type ChildProcess } from "node:child_process";
import type { AgentConfig, AgentListItem, CustomAgent, AgentEnvProfile } from "@matrix/protocol";
import { isAgentAvailable } from "./config.js";

export interface AgentHandle {
  agentId: string;
  process: ChildProcess;
  cwd: string;
}

export type AgentSource = "builtin" | "custom";

interface AgentEntry {
  config: AgentConfig;
  source: AgentSource;
  profiles: AgentEnvProfile[];
}

export class AgentManager {
  private entries = new Map<string, AgentEntry>();

  register(config: AgentConfig, source: AgentSource = "builtin"): void {
    const existing = this.entries.get(config.id);
    this.entries.set(config.id, {
      config,
      source,
      profiles: existing?.profiles ?? [],
    });
  }

  /**
   * Merge custom agents and profiles from the Store into the registry.
   * Called after discovery and after any CRUD operation.
   */
  mergeCustomConfigs(customAgents: CustomAgent[], profiles: AgentEnvProfile[]): void {
    // Remove previously registered custom agents
    for (const [id, entry] of this.entries) {
      if (entry.source === "custom") {
        this.entries.delete(id);
      }
    }

    // Register custom agents
    for (const agent of customAgents) {
      this.entries.set(agent.id, {
        config: {
          id: agent.id,
          name: agent.name,
          command: agent.command,
          args: agent.args,
          env: agent.env,
          icon: agent.icon,
          description: agent.description,
        },
        source: "custom",
        profiles: [],
      });
    }

    // Clear all profiles and re-attach
    for (const entry of this.entries.values()) {
      entry.profiles = [];
    }
    for (const profile of profiles) {
      const entry = this.entries.get(profile.parentAgentId);
      if (entry) {
        entry.profiles.push(profile);
      }
    }
  }

  listAgents(): AgentListItem[] {
    return Array.from(this.entries.values()).map((entry) => ({
      id: entry.config.id,
      name: entry.config.name,
      command: entry.config.command,
      available: isAgentAvailable(entry.config),
      icon: entry.config.icon,
      description: entry.config.description,
      source: entry.source,
      profiles: entry.profiles.map((p) => ({ id: p.id, name: p.name })),
    }));
  }

  spawn(agentId: string, cwd: string, profileId?: string): AgentHandle {
    const entry = this.entries.get(agentId);
    if (!entry) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    // Merge env: process.env → agent.env → profile.env
    let env = { ...process.env, ...entry.config.env, CLAUDECODE: undefined };
    if (profileId) {
      const profile = entry.profiles.find((p) => p.id === profileId);
      if (profile) {
        env = { ...env, ...profile.env };
      }
    }

    const child = spawn(entry.config.command, entry.config.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    return {
      agentId,
      process: child,
      cwd,
    };
  }

  getConfig(agentId: string): AgentConfig | undefined {
    return this.entries.get(agentId)?.config;
  }

  getProfile(profileId: string): AgentEnvProfile | undefined {
    for (const entry of this.entries.values()) {
      const profile = entry.profiles.find((p) => p.id === profileId);
      if (profile) return profile;
    }
    return undefined;
  }
}
