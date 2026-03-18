# Dynamic ACP Agent Discovery — Implementation Plan

Design doc: `docs/plans/2026-03-18-dynamic-acp-discover-design.md`

## Context

Currently agents are hardcoded in `packages/server/src/config.ts` (only Claude Code ACP). This plan adds dynamic discovery of ACP-compatible agents by fetching the official ACP Registry and detecting which agents are installed locally.

### Key files (current state)

- `packages/protocol/src/agent.ts` — `AgentConfig`, `AgentInfo`, `AgentCapabilities` types
- `packages/protocol/src/api.ts` — `AgentListItem` type (id, name, command, available)
- `packages/server/src/config.ts` — `ServerConfig` with hardcoded `agents: AgentConfig[]`
- `packages/server/src/agent-manager/index.ts` — `AgentManager` class (register, listAgents, spawn)
- `packages/server/src/agent-manager/config.ts` — `isAgentAvailable()` helper
- `packages/server/src/index.ts` — server entry, registers agents from `config.agents`
- `packages/server/src/acp-bridge/index.ts` — `AcpBridge` class, does `initialize` handshake

### ACP Registry format (from cdn.agentclientprotocol.com)

```json
{
  "agents": [
    {
      "id": "codex-acp",
      "name": "Codex CLI",
      "description": "ACP adapter for OpenAI's coding assistant",
      "icon": "https://cdn.agentclientprotocol.com/.../codex-acp.svg",
      "distribution": {
        "npx": { "package": "@zed-industries/codex-acp@0.10.0" },
        "binary": { ... }
      }
    },
    {
      "id": "gemini",
      "name": "Gemini CLI",
      "distribution": {
        "npx": { "package": "@google/gemini-cli@0.34.0", "args": ["--acp"] }
      }
    }
  ]
}
```

---

## Step 1: Extend protocol types

**File: `packages/protocol/src/agent.ts`**

Add `icon` and `description` optional fields to `AgentConfig`:

```ts
export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  icon?: string;        // NEW
  description?: string; // NEW
}
```

**File: `packages/protocol/src/api.ts`**

Add `icon` and `description` to `AgentListItem`:

```ts
export interface AgentListItem {
  id: string;
  name: string;
  command: string;
  available: boolean;
  icon?: string;        // NEW
  description?: string; // NEW
}
```

## Step 2: Create known-agents mapping table

**NEW file: `packages/server/src/agent-manager/known-agents.ts`**

```ts
export interface KnownAgent {
  /** Agent ID in the ACP Registry */
  registryId: string;
  /** Command to detect on the local system */
  detectCommand: string;
}

export const KNOWN_AGENTS: KnownAgent[] = [
  { registryId: "claude-acp", detectCommand: "claude" },
  { registryId: "codex-acp", detectCommand: "codex" },
  { registryId: "gemini", detectCommand: "gemini" },
  { registryId: "cline", detectCommand: "cline" },
  { registryId: "auggie", detectCommand: "auggie" },
  { registryId: "amp-acp", detectCommand: "amp" },
  { registryId: "codebuddy-code", detectCommand: "codebuddy" },
  { registryId: "aider", detectCommand: "aider" },
];
```

## Step 3: Create discovery module

**NEW file: `packages/server/src/agent-manager/discovery.ts`**

Responsibilities:
- Fetch ACP Registry JSON from `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` (10s timeout)
- For each entry in `KNOWN_AGENTS`, check if `detectCommand` exists locally (use `execSync("command -v <cmd>")`)
- If installed AND registry has `distribution.npx` for that agent, build an `AgentConfig`:
  - `command: "npx"`
  - `args: ["-y", npx.package, ...(npx.args ?? [])]`
  - `env: npx.env`
  - `icon`, `description` from manifest
- If registry fetch fails or no agents discovered, return fallback: the current hardcoded `claude-code-acp` config
- Export: `async function discoverAgents(): Promise<AgentConfig[]>`

Registry types needed internally:
```ts
interface RegistryNpxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}
interface RegistryAgent {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  distribution?: {
    npx?: RegistryNpxDistribution;
  };
}
interface RegistryResponse {
  agents: RegistryAgent[];
}
```

Log each discovered agent: `[discovery] Found <name> (<detectCommand> → npx <package>)`

## Step 4: Update AgentManager to include icon/description

**File: `packages/server/src/agent-manager/index.ts`**

Update `listAgents()` to pass through `icon` and `description` from config:

```ts
listAgents(): AgentListItem[] {
  return Array.from(this.configs.values()).map((config) => ({
    id: config.id,
    name: config.name,
    command: config.command,
    available: isAgentAvailable(config),
    icon: config.icon,
    description: config.description,
  }));
}
```

## Step 5: Update config.ts — remove hardcoded agents

**File: `packages/server/src/config.ts`**

- Remove `agents` field from `ServerConfig` interface
- Remove the `agents: [...]` array from `loadConfig()` return
- Remove the `import type { AgentConfig }` (no longer needed)

## Step 6: Update index.ts — async discovery on startup

**File: `packages/server/src/index.ts`**

Replace:
```ts
// Register configured agents
for (const agent of config.agents) {
  agentManager.register(agent);
}
```

With:
```ts
import { discoverAgents } from "./agent-manager/discovery.js";

// Discover and register ACP agents
const discoveredAgents = await discoverAgents();
for (const agent of discoveredAgents) {
  agentManager.register(agent);
}
```

Also update the startup log at the bottom:
```ts
// Change:
console.log(`\n  Registered agents: ${config.agents.map((a) => a.name).join(", ")}\n`);
// To:
console.log(`\n  Discovered agents: ${discoveredAgents.map((a) => a.name).join(", ")}\n`);
```

## Step 7: Add capability validation in session creation

**File: `packages/server/src/index.ts`** (in the `createBridge` function)

After the `initialize` handshake (line ~200), add validation:

```ts
await bridge.initialize({ name: "matrix-server", version: "0.1.0" });

// Validate agent capabilities
const missing = validateCapabilities(bridge.capabilities);
if (missing.length > 0) {
  bridge.destroy();
  throw new Error(`Agent "${agentId}" missing required capabilities: ${missing.join(", ")}`);
}
```

Add a helper function (can be in the same file or in a new utility):

```ts
function validateCapabilities(caps: AgentCapabilities | null): string[] {
  // For now, no hard requirements — all mainstream agents should work.
  // Add checks here as needed, e.g.:
  // if (!caps?.promptCapabilities?.embeddedContext) missing.push("embeddedContext");
  return [];
}
```

This is intentionally a no-op stub for now. The infrastructure is in place to add checks as Matrix's requirements evolve.

## Step 8: Verify

- Run `pnpm build` to ensure TypeScript compiles
- Run `pnpm dev` (or start the server) and verify discovery logs show detected agents
- Test with at least one installed agent (e.g., `claude`) — verify it appears in `GET /agents`

---

## Summary of changes

| File | Action |
|------|--------|
| `packages/protocol/src/agent.ts` | Add `icon`, `description` to `AgentConfig` |
| `packages/protocol/src/api.ts` | Add `icon`, `description` to `AgentListItem` |
| `packages/server/src/agent-manager/known-agents.ts` | **NEW** — mapping table |
| `packages/server/src/agent-manager/discovery.ts` | **NEW** — registry fetch + local detection |
| `packages/server/src/agent-manager/index.ts` | Pass `icon`, `description` in `listAgents()` |
| `packages/server/src/config.ts` | Remove `agents` from `ServerConfig` |
| `packages/server/src/index.ts` | Use `discoverAgents()`, add capability validation stub |
