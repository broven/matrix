import { execSync } from "node:child_process";
import { platform } from "node:os";
import type { AgentConfig } from "@matrix/protocol";
import { KNOWN_AGENTS, type KnownAgent } from "./known-agents.js";
import { logger } from "../logger.js";

const log = logger.child({ target: "discovery" });

export interface RegistryAgent {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  distribution?: {
    npx?: {
      package: string;
      args?: string[];
      env?: Record<string, string>;
    };
  };
}

export interface RegistryResponse {
  agents: RegistryAgent[];
}

const REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const FETCH_TIMEOUT_MS = 3_000;

export function isCommandInstalled(command: string): boolean {
  try {
    const checkCmd =
      platform() === "win32" ? `where.exe ${command}` : `command -v ${command}`;
    execSync(checkCmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function fetchRegistry(): Promise<RegistryResponse | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      log.warn({ status: response.status }, "registry fetch failed");
      return null;
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.agents)) {
      log.warn("invalid registry shape");
      return null;
    }
    return data as RegistryResponse;
  } catch (error) {
    log.warn({ err: error }, "registry fetch failed");
    return null;
  }
}

export const FALLBACK_AGENTS: AgentConfig[] = [
  {
    id: "claude-acp",
    name: "Claude Code",
    command: process.env.CLAUDE_CODE_ACP_PATH || "claude-code-acp",
    args: [],
  },
];

/** Dependencies that can be injected for testing */
export interface DiscoveryDeps {
  checkCommand: (cmd: string) => boolean;
  fetchRegistryData: () => Promise<RegistryResponse | null>;
  knownAgents: KnownAgent[];
}

/**
 * Core discovery logic, testable with injected dependencies.
 */
export async function discoverAgentsWithDeps(deps: DiscoveryDeps): Promise<AgentConfig[]> {
  if (!deps.checkCommand("npx")) {
    log.warn("npx not found, using fallback agents");
    return FALLBACK_AGENTS;
  }

  let registry: RegistryResponse | null = null;
  try {
    registry = await deps.fetchRegistryData();
  } catch (error) {
    log.warn({ err: error }, "registry discovery failed");
  }

  const registryMap = new Map<string, RegistryAgent>();
  if (registry) {
    for (const agent of registry.agents) {
      registryMap.set(agent.id, agent);
    }
  }

  const discovered: AgentConfig[] = [];

  for (const known of deps.knownAgents) {
    if (!deps.checkCommand(known.detectCommand)) {
      continue;
    }

    // Use registry only for metadata (icon, description, name).
    // Package, args, and env come from the local allowlist.
    const manifest = registryMap.get(known.registryId);

    const config: AgentConfig = {
      id: known.registryId,
      name: manifest?.name ?? known.detectCommand,
      command: "npx",
      args: ["-y", known.npxPackage, ...(known.npxArgs ?? [])],
      env: known.env,
      icon: manifest?.icon,
      description: manifest?.description,
    };

    discovered.push(config);
    log.info({ agent: config.name, command: known.detectCommand, npxPackage: known.npxPackage }, "discovered agent");
  }

  if (discovered.length === 0) {
    log.warn("no agents discovered, using fallback");
    return FALLBACK_AGENTS;
  }

  return discovered;
}

/** Production entry point — wires in real dependencies */
export async function discoverAgents(): Promise<AgentConfig[]> {
  return discoverAgentsWithDeps({
    checkCommand: isCommandInstalled,
    fetchRegistryData: fetchRegistry,
    knownAgents: KNOWN_AGENTS,
  });
}
