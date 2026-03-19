# Dynamic ACP Agent Discovery

## Problem

Agents are hardcoded in `config.ts` (only Claude Code). Users who have other ACP-compatible agents installed (Codex, Gemini CLI, Cline, etc.) must manually configure them.

## Solution

On startup, fetch the ACP Registry, match against a built-in mapping table of known agents, detect which are locally installed, and auto-register them. ACP adapter layers are run via `npx -y <package>` at session creation time.

## Flow

```
Server startup
  1. Load built-in known-agents mapping table
  2. Fetch ACP Registry (cdn.agentclientprotocol.com/registry/v1/latest/registry.json)
  3. For each known agent:
     - which <detectCommand> → installed?
     - Yes → match with registry manifest → extract npx distribution
     - Register to AgentManager
  4. GET /agents returns discovered + hardcoded agents

Session creation
  5. Spawn via: npx -y <package> [args]
  6. ACP initialize handshake → get agentCapabilities
  7. Validate minimum required capabilities
     - Missing → return error listing missing capabilities
     - OK → create session normally
```

## Key Design Decisions

- **Built-in mapping table** (`known-agents.ts`): maps registry ID → local detect command. Adding new agents requires a code change.
- **npx for adapter layers**: all agents launched via `npx -y <package>`, whether the package is a wrapper (codex-acp) or native (gemini --acp). npx reuses local installs automatically.
- **Lazy capability validation**: capabilities checked at session creation, not at discovery time. Simpler, and most mainstream agents will pass.
- **Registry fetch failure fallback**: falls back to current hardcoded claude-code-acp config.

## Files to Change

- `packages/server/src/agent-manager/known-agents.ts` — NEW: mapping table + discovery logic
- `packages/server/src/agent-manager/discovery.ts` — NEW: fetch registry, detect local agents
- `packages/server/src/agent-manager/index.ts` — add capability validation on spawn
- `packages/server/src/agent-manager/config.ts` — update isAgentAvailable for npx agents
- `packages/server/src/config.ts` — remove hardcoded agents, call discovery
- `packages/server/src/index.ts` — async agent discovery on startup
- `packages/protocol/src/agent.ts` — add icon/description to AgentConfig; add AgentListItem fields
- `packages/protocol/src/api.ts` — update AgentListItem with icon/description
