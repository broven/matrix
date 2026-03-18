import { execSync } from "node:child_process";
import { platform } from "node:os";
import type { AgentConfig } from "@matrix/protocol";
import { KNOWN_AGENTS } from "./known-agents.js";

interface RegistryAgent {
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

interface RegistryResponse {
  agents: RegistryAgent[];
}

const REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const FETCH_TIMEOUT_MS = 3_000;

function isCommandInstalled(command: string): boolean {
  try {
    const checkCmd =
      platform() === "win32" ? `where.exe ${command}` : `command -v ${command}`;
    execSync(checkCmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function fetchRegistry(): Promise<RegistryResponse | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn(`[discovery] Registry fetch failed: HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.agents)) {
      console.warn("[discovery] Registry response has invalid shape");
      return null;
    }
    return data as RegistryResponse;
  } catch (error) {
    console.warn(`[discovery] Registry fetch failed:`, error);
    return null;
  }
}

const FALLBACK_AGENTS: AgentConfig[] = [
  {
    id: "claude-acp",
    name: "Claude Code",
    command: process.env.CLAUDE_CODE_ACP_PATH || "claude-code-acp",
    args: [],
  },
];

export async function discoverAgents(): Promise<AgentConfig[]> {
  if (!isCommandInstalled("npx")) {
    console.warn("[discovery] npx not found on PATH, using fallback agents");
    return FALLBACK_AGENTS;
  }

  let registry: RegistryResponse | null = null;
  try {
    registry = await fetchRegistry();
  } catch (error) {
    console.warn("[discovery] Registry discovery failed:", error);
  }

  const registryMap = new Map<string, RegistryAgent>();
  if (registry) {
    for (const agent of registry.agents) {
      registryMap.set(agent.id, agent);
    }
  }

  const discovered: AgentConfig[] = [];

  for (const known of KNOWN_AGENTS) {
    if (!isCommandInstalled(known.detectCommand)) {
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
    console.log(
      `[discovery] Found ${config.name} (${known.detectCommand} → npx ${known.npxPackage})`,
    );
  }

  if (discovered.length === 0) {
    console.warn("[discovery] No agents discovered, using fallback");
    return FALLBACK_AGENTS;
  }

  return discovered;
}
