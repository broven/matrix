# Slash Command Autocomplete Design

## Overview

When users type `/` in the chat input, show an inline dropdown with available slash commands from the current ACP agent. Commands are discovered via the ACP protocol's `available_commands_update` notification and cached per worktree + agent.

## Design Decisions

- **Scope**: Only show commands from the current active session's agent
- **UI**: Inline dropdown at cursor position (like Slack/Discord)
- **Selection behavior**: Select a command → replace text with `/commandName` → send immediately
- **Trigger**: Any position in input where `/` is typed
- **Caching**: Per `worktreeId:agentId`, so different worktrees or different agents have independent caches
- **Display**: Two-line items — command name on first line, description on second, truncated with ellipsis if overflow

## Data Flow

```
Agent (Claude Code, Codex, etc.)
  │  session/notification: available_commands_update
  ▼
ACP Bridge (handleMessage)
  │  Parse notification, notify upper layer
  ▼
CommandCache
  │  Store by worktreeId:agentId key
  ▼
ConnectionManager
  │  broadcastToSession → WebSocket
  ▼
Client SDK (session state)
  │  Store availableCommands
  ▼
PromptInput
  │  Detect "/" → filter commands → render dropdown
  ▼
User selects → replace + send
```

## Protocol Changes

### `packages/protocol/src/session.ts`

Add new `SessionUpdate` variant:

```typescript
| {
    sessionUpdate: "available_commands_update";
    availableCommands: AvailableCommand[];
  }
```

New type:

```typescript
interface AvailableCommand {
  name: string;
  description?: string;
  input?: {
    type: "unstructured";
    hint?: string;
  };
}
```

No changes needed to `transport.ts` — existing `session:update` message type carries any `SessionUpdate`.

## Server Changes

### 1. ACP Bridge (`acp-bridge/index.ts`)

In `handleMessage()`, recognize `available_commands_update`:

```typescript
if (update.sessionUpdate === "available_commands_update") {
  handlers.onAvailableCommandsUpdate(update.availableCommands);
}
// Continue broadcasting to client as normal
```

### 2. Command Cache (new module)

```typescript
class CommandCache {
  private cache = new Map<string, AvailableCommand[]>();

  private key(worktreeId: string, agentId: string) {
    return `${worktreeId}:${agentId}`;
  }

  set(worktreeId: string, agentId: string, commands: AvailableCommand[]) {
    this.cache.set(this.key(worktreeId, agentId), commands);
  }

  get(worktreeId: string, agentId: string): AvailableCommand[] | undefined {
    return this.cache.get(this.key(worktreeId, agentId));
  }
}
```

In-memory only. Rebuilt on next session after server restart.

### 3. Session Creation

After `session/new` completes, check cache and push immediately:

```typescript
const cached = commandCache.get(worktreeId, agentId);
if (cached) {
  connectionManager.broadcastToSession(sessionId, {
    type: "session:update",
    sessionId,
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: cached,
    },
  });
}
```

## Client Changes

### 1. Session State

Add `availableCommands: AvailableCommand[]` to session state. Update on receiving `available_commands_update`.

### 2. PromptInput Component

Detect `/` input at any cursor position:

- Extract text from last `/` to cursor as filter query
- Match against `availableCommands` by name/description
- Show dropdown if matches exist, hide if no matches or no cached commands

Keyboard navigation:
- `↑` / `↓` — select item
- `Enter` — confirm selection (replace text + send)
- `Esc` — close dropdown

### 3. Dropdown UI

Absolutely positioned list near input cursor. Each item:

```
┌──────────────────────────┐
│ /compact                 │
│ Compact conversation     │
├──────────────────────────┤
│ /review                  │
│ Review current change... │
└──────────────────────────┘
```

- First line: command name (bold)
- Second line: description (muted, `text-overflow: ellipsis`)
- No Radix DropdownMenu (needs trigger element) — simple absolute-positioned div
