# ACP Client Configuration Design

## Problem

Currently, ACP agents are discovered automatically from a hardcoded `KNOWN_AGENTS` list + local CLI detection + ACP Registry metadata. Users cannot:

1. Run the same agent (e.g., Claude Code) with different env vars (different API keys, backends)
2. Add custom ACP-compliant agents not in the built-in list
3. Use a mock ACP client for stable e2e testing

## Scenarios

1. **Same agent, different env** — Claude Code with official backend vs 3P backend, different API keys. Sessions should be cross-resumable between profiles of the same agent.
2. **Custom ACP agent** — User-written or niche agents that implement ACP protocol, manually configured.
3. **E2E mock agent** — A minimal ACP-compliant script for test stability, registered as a custom agent.

## Key Decisions

| Decision | Choice |
|---|---|
| Profile scope | Agent-level (not global) |
| Custom agent model | Template (derive from built-in) + from-scratch |
| Mock ACP client | Standalone script, spawned as real process |
| Settings UI | Single "Agents" tab in sidebar |
| Profile display | Folded under parent agent |
| Data persistence | Server-side Store |
| Multi-server | No sync, each server independent, client displays separately |
| Cross-profile resume | Yes, sessions belong to parent agent, profile can change on resume |
| Custom agent profiles | Yes, same model as built-in agents |
| Built-in agent mutation | Not editable/deletable, but can Fork into CustomAgent |

## Data Model

### AgentEnvProfile (new)

```typescript
interface AgentEnvProfile {
  id: string;            // e.g. "claude-acp--3p-backend"
  parentAgentId: string; // e.g. "claude-acp" — built-in or custom agent id
  name: string;          // e.g. "3P Backend"
  env: Record<string, string>;
}
```

### CustomAgent (new)

```typescript
interface CustomAgent {
  id: string;            // user-defined, e.g. "my-local-agent"
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  icon?: string;
  description?: string;
}
```

### AgentDefinition (runtime, unified)

Extends existing `AgentConfig` with source tracking:

```typescript
interface AgentDefinition extends AgentConfig {
  source: "builtin" | "custom";
  profiles: AgentEnvProfile[];
}
```

### Session model changes

```typescript
// session:create — new optional profileId
{ agentId: "claude-acp", profileId?: "3p-backend", cwd: "..." }

// session:resume — can switch profile
{ sessionId: "xxx", profileId?: "personal" }
```

Session is bound to `agentId` (the parent), not the profile. This enables cross-profile resume.

### Runtime spawn logic

```
final_env = { ...process.env, ...agent.env, ...profile.env }
```

Profile env overrides agent default env, agent env overrides process env.

## Server Changes

### Store

New collections:

```typescript
customAgents: CustomAgent[]
agentEnvProfiles: AgentEnvProfile[]
```

### AgentManager

New merge method:

```typescript
mergeCustomConfigs(
  customAgents: CustomAgent[],
  profiles: AgentEnvProfile[]
): void
```

Called after discovery and after any CRUD operation. Registers custom agents as `AgentConfig`, attaches profiles to all agents (built-in + custom).

### WebSocket API

New messages:

```
custom-agent:list    → CustomAgent[]
custom-agent:create  → { name, command, args, env? }
custom-agent:update  → { id, name?, command?, args?, env? }
custom-agent:delete  → { id }

agent-profile:list   → AgentEnvProfile[]
agent-profile:create → { parentAgentId, name, env }
agent-profile:update → { id, name?, env? }
agent-profile:delete → { id }
```

Existing API changes:

```typescript
// agent:list — returns unified list with profiles inlined
{
  agents: [{
    id: "claude-acp",
    name: "Claude Code",
    source: "builtin",
    available: true,
    profiles: [
      { id: "3p-backend", name: "3P Backend" },
      { id: "personal", name: "Personal" }
    ]
  }, ...]
}
```

### Availability

- Built-in agent not installed → agent + all its profiles hidden from session creation
- Still visible in Settings Agents tab, greyed out with "Not available on current server"
- Custom agent availability checked via `isAgentAvailable` (absolute path → file exists check)

## Settings UI

### Sidebar

New "Agents" tab, same level as General and Repositories.

### Agents Tab Layout

```
Agents                                  [+ New Agent]

── Built-in ─────────────────────────────────────────
🟢 Claude Code              [Fork] [+ Profile]
   ├─ 3P Backend             [Edit] [Delete]
   └─ Personal               [Edit] [Delete]
🟢 Codex                    [Fork] [+ Profile]
⚫ Gemini (not installed)

── Custom ───────────────────────────────────────────
🟢 My Local Agent   [Edit] [Delete] [+ Profile]
   └─ Staging                [Edit] [Delete]
```

### Interactions

- **Fork** (built-in only): Opens dialog pre-filled with parent's command/args. User modifies name/env → saved as CustomAgent.
- **+ New Agent**: From-scratch dialog — name, command, args, env.
- **+ Profile**: Dialog — name + env key-value editor.
- **Edit**: Inline or dialog edit of name/command/args/env.
- **Delete**: Confirmation dialog, cascades to delete associated profiles.
- **Env Editor**: Key-value table, add/remove rows. Values containing KEY/TOKEN/SECRET masked as `••••••`.
- **Multi-server**: If connected to multiple servers, top-level server selector or grouped display.

### data-testid attributes

Per project conventions:

- `agents-tab` — sidebar tab
- `add-custom-agent-btn` — new agent button
- `fork-agent-btn-{agentId}` — fork button
- `add-profile-btn-{agentId}` — add profile button
- `agent-item-{agentId}` — agent row
- `profile-item-{profileId}` — profile row
- `edit-agent-btn-{agentId}` — edit button
- `delete-agent-btn-{agentId}` — delete button

## E2E Mock ACP Client

### Mock script

`tests/mock-acp-agent.ts` — minimal ACP implementation over stdin/stdout JSON-RPC:

- `initialize` → returns agent info + capabilities (including `loadSession: true`)
- `prompt` → returns fixed text response (or simple pattern matching on input)
- Supports session resume for cross-profile resume testing

### Test setup

```typescript
// tests/release/lib/setup.ts
await ws.send("custom-agent:create", {
  name: "Mock Agent",
  command: "node",
  args: ["path/to/mock-acp-agent.js"],
});
```

Full real path: WebSocket API → Store → AgentManager → spawn mock process → ACP protocol over stdio.

## Implementation Order

1. **Data model + Store** — `CustomAgent`, `AgentEnvProfile` types, Store CRUD
2. **AgentManager merge** — combine discovery + custom + profiles
3. **WebSocket API** — CRUD messages + updated `agent:list`
4. **Session changes** — `profileId` in create/resume, env merge on spawn
5. **Mock ACP script** — minimal ACP implementation for testing
6. **Settings UI — Agents tab** — agent list, profiles, fork/edit/delete
7. **Create Session UI** — profile selector when creating/resuming sessions
