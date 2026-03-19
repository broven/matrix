# Git Worktree-Based Sessions

## Problem

Sessions are currently path-based: the user types a `cwd` path to create a session. This is fragile, unstructured, and doesn't support the core use case of running multiple agents in parallel on isolated branches of the same codebase.

## Solution

Replace the path-based session model with a **git repository + worktree** model. Users add git repositories (existing local repos or clone from remote). Each repo appears in the sidebar. Clicking `+` on a repo creates a git worktree (via [Worktrunk](https://worktrunk.dev/)), which becomes the workspace for one or more agent sessions.

## Data Model

```
Repository  1──▶ N  Worktree  1──▶ N  AgentSession
```

### Repository

A git repo registered on a server. Can be local (already on disk) or cloned from a remote URL.

```typescript
interface Repository {
  id: string;              // repo_<nanoid>
  name: string;            // display name (e.g. "colombo")
  path: string;            // absolute path to main repo on server
  remoteUrl?: string;      // origin URL if cloned
  serverId: string;        // which server this repo lives on
  defaultBranch: string;   // e.g. "main"
  createdAt: string;
}
```

### Worktree

An isolated working copy created from a repository. Replaces the old "session" as the primary workspace unit.

```typescript
interface Worktree {
  id: string;              // wt_<nanoid>
  repositoryId: string;
  branch: string;          // git branch name
  baseBranch: string;      // branched from (e.g. "main")
  path: string;            // worktree filesystem path (computed by wt)
  taskDescription?: string;// optional user-provided context
  status: 'active' | 'suspended' | 'closed';
  createdAt: string;
  lastActiveAt: string;
}
```

### AgentSession

An agent working inside a worktree. Phase 1: exactly one per worktree. Phase 2: N agents per worktree.

```typescript
interface AgentSession {
  id: string;              // sess_<nanoid>
  worktreeId: string;
  agentId: string;         // which ACP agent (e.g. "claude-code")
  agentSessionId?: string; // internal agent session ID for restore
  status: 'active' | 'suspended' | 'restoring' | 'closed';
  recoverable: boolean;
  createdAt: string;
  lastActiveAt: string;
  suspendedAt?: string;
  closeReason?: string;
}
```

### Settings (new fields)

```typescript
// Persisted in server store or client settings
interface UserSettings {
  defaultAgentId: string;  // default ACP client for new worktrees
  // ... existing settings
}
```

## Worktrunk Integration

[Worktrunk](https://github.com/max-sixty/worktrunk) (`wt`) is a Rust CLI for git worktree management. It addresses worktrees by branch name (not path), provides lifecycle hooks, and handles cleanup.

**Integration strategy:** Use as a library (Rust crate) if the server is Bun/Node-based (via NAPI or WASM). **Fallback:** shell out to `wt` CLI.

Since Matrix server runs on Bun (not Rust), the practical approach is:

1. **Primary:** Shell out to `wt` CLI commands
2. **Future:** If Worktrunk publishes WASM/NAPI bindings, switch to library usage

### Commands Used

| Operation | Command | When |
|-----------|---------|------|
| Create worktree | `wt switch -c <branch> --base <base>` | User clicks `+` on repo |
| List worktrees | `wt list --json` | Sidebar refresh, repo status |
| Remove worktree | `wt remove <branch>` | Session closed/deleted |
| Merge worktree | `wt merge <target>` | Future: merge UI |

### Hooks

Worktrunk provides `post-create` and `pre-remove` hooks (configured in repo's `wt.toml`). These can run setup/teardown scripts (e.g. `npm install`, kill dev servers). Matrix does **not** manage these hooks — they are the user's repo-level concern.

## UI Changes

### Sidebar (Left Panel)

**Before:**
```
Sessions
├ claude-code • /path/to/project   🟢
├ claude-code • /other/project     🟡
└ [+ New Session]
```

**After:**
```
Repositories
▼ colombo                          [+]
  ├ feat/auth          🟢 claude-code
  ├ fix/bug-123        🟡 codex
  └ main               (no session)
▼ my-api                           [+]
  └ refactor/db        🟢 claude-code
[+ Add Repository]
```

- Repos are collapsible tree nodes
- Each worktree shows: branch name, status dot, agent name
- `[+]` on repo opens the **New Worktree Dialog**
- `[+ Add Repository]` opens the **Add Repository Dialog**

### New Worktree Dialog

Triggered by clicking `[+]` on a repository.

Fields:
- **Branch name** — text input (required, auto-prefixed options)
- **Base branch** — dropdown: main, develop, or any existing branch (default: repo's defaultBranch)
- **Agent** — dropdown of available agents (default: user's `defaultAgentId` from settings)
- **Task description** — textarea (optional, passed to agent as initial context)

Actions: **Create** / **Cancel**

On Create:
1. Server runs `wt switch -c <branch> --base <base>` in the repo directory
2. Server stores Worktree record in SQLite
3. Server spawns agent session in the new worktree path
4. Client navigates to the new session view

### Add Repository Dialog

Fields:
- **Source** — radio: "Existing local path" / "Clone from URL"
  - Local: directory path input
  - Clone: git URL input + destination path
- **Server** — dropdown of connected servers (for remote servers)
- **Name** — auto-filled from repo/URL, editable

On Add:
1. If clone: server runs `git clone <url> <path>`
2. Server validates it's a git repo (`git rev-parse --git-dir`)
3. Server detects default branch
4. Server stores Repository record

### Settings Page

New section: **Default Agent**

- Dropdown of available ACP agents
- Selected agent is pre-filled when creating new worktrees
- Persisted in client settings (per-server)

### Session View (Chat Panel)

Mostly unchanged. Header now shows:
- Repository name + branch name (instead of just path)
- Worktree status indicator

## API Changes

### New Endpoints

```
# Repositories
POST   /repositories              # Add/register a repository
GET    /repositories              # List all repositories
DELETE /repositories/:id          # Remove repository (does not delete files)

# Worktrees
POST   /repositories/:repoId/worktrees    # Create worktree (calls wt switch -c)
GET    /repositories/:repoId/worktrees    # List worktrees for a repo
DELETE /worktrees/:id                      # Close + remove worktree (calls wt remove)
```

### Modified Endpoints

```
# Sessions — now scoped to worktree
POST /sessions
  Before: { agentId, cwd }
  After:  { agentId, worktreeId }
  (Server resolves cwd from worktree.path)

GET /sessions
  Response: SessionInfo now includes worktreeId, repositoryId, branch
```

### Protocol Type Changes

```typescript
// NEW
interface CreateWorktreeRequest {
  branch: string;
  baseBranch: string;
  agentId: string;           // agent to start in this worktree
  taskDescription?: string;
}

interface CreateWorktreeResponse {
  worktree: WorktreeInfo;
  session: CreateSessionResponse;  // auto-created session
}

interface WorktreeInfo {
  id: string;
  repositoryId: string;
  branch: string;
  baseBranch: string;
  path: string;
  status: 'active' | 'suspended' | 'closed';
  taskDescription?: string;
  createdAt: string;
  lastActiveAt: string;
}

interface RepositoryInfo {
  id: string;
  name: string;
  path: string;
  remoteUrl?: string;
  serverId: string;
  defaultBranch: string;
}

// MODIFIED
interface CreateSessionRequest {
  agentId: string;
  worktreeId: string;        // replaces cwd
}

interface SessionInfo {
  // ... existing fields
  worktreeId: string;        // NEW
  repositoryId: string;      // NEW (denormalized for convenience)
  branch: string;            // NEW (denormalized)
  // cwd remains, but is derived from worktree.path
}
```

## Worktree Lifecycle

```
User clicks [+] on repo
  │
  ▼
New Worktree Dialog
  │ branch, baseBranch, agentId, taskDescription
  ▼
POST /repositories/:repoId/worktrees
  │
  ├─▶ wt switch -c <branch> --base <base>
  │     (Worktrunk creates worktree, runs post-create hooks)
  │
  ├─▶ INSERT worktree record into SQLite
  │
  ├─▶ AgentManager.spawn(agentId, worktree.path)
  │     (Creates AcpBridge, initializes agent)
  │
  ├─▶ INSERT session record into SQLite
  │
  └─▶ Response: { worktree, session }

User closes/deletes worktree
  │
  ▼
DELETE /worktrees/:id
  │
  ├─▶ Close all agent sessions in this worktree
  │     (Kill agent processes, mark sessions closed)
  │
  ├─▶ wt remove <branch>
  │     (Worktrunk runs pre-remove hooks, removes worktree + branch)
  │
  └─▶ DELETE worktree + session records from SQLite
```

## Storage Changes

### New SQLite Tables

```sql
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  remote_url TEXT,
  server_id TEXT NOT NULL DEFAULT 'local',
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  path TEXT NOT NULL,
  task_description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sessions table: add worktree_id column, keep cwd (derived)
ALTER TABLE sessions ADD COLUMN worktree_id TEXT REFERENCES worktrees(id);
```

## Multi-Agent per Worktree (Phase 2 — Design Only)

Phase 1 creates exactly one agent session per worktree. The schema already supports N:1 via the `AgentSession.worktreeId` foreign key.

**Phase 2 UI concept:**
- Worktree view has a tab bar at top: one tab per agent session
- `[+]` tab to add another agent to the same worktree
- Each agent gets its own chat panel, shares the same filesystem
- Agents can be different types (e.g. Claude Code + Codex reviewing together)

**No code changes needed for Phase 2 in the data model** — the schema is ready. Only UI and session creation logic need updates.

## Migration Path

1. **Schema migration:** Add `repositories` and `worktrees` tables. Add `worktree_id` to `sessions`.
2. **Existing sessions:** Sessions without `worktree_id` continue to work as legacy path-based sessions. Sidebar shows them in a separate "Legacy Sessions" group until user migrates or deletes them.
3. **API backward compat:** `POST /sessions { agentId, cwd }` still works for legacy usage. New flow uses `POST /repositories/:repoId/worktrees`.
4. **Deprecation:** After a few releases, remove legacy session creation path.

## Files to Change

### packages/protocol/
- `src/session.ts` — add worktreeId to SessionInfo types
- `src/api.ts` — add Repository/Worktree request/response types, modify CreateSessionRequest
- `src/repository.ts` — NEW: RepositoryInfo, WorktreeInfo types
- `src/settings.ts` — NEW or modify: add defaultAgentId

### packages/server/
- `src/store/index.ts` — add repositories/worktrees tables, migration, CRUD methods
- `src/api/rest/index.ts` — add repository + worktree routes
- `src/worktree-manager/index.ts` — NEW: wraps `wt` CLI calls (switch, list, remove)
- `src/session-manager/index.ts` — modify to accept worktreeId instead of cwd
- `src/index.ts` — register new routes

### packages/client/
- `src/components/layout/Sidebar.tsx` — replace session list with repo→worktree tree
- `src/components/layout/SessionItem.tsx` — show branch name, repo context
- `src/components/repository/AddRepositoryDialog.tsx` — NEW
- `src/components/worktree/NewWorktreeDialog.tsx` — NEW
- `src/pages/SettingsPage.tsx` — add default agent selector
- `src/hooks/useMatrixClient.tsx` — add repository/worktree state and methods

### packages/sdk/
- `src/client.ts` — add repository/worktree API methods

## Open Questions

1. **`wt` availability:** Should the server validate that `wt` is installed at startup? Or gracefully fall back to raw `git worktree add/remove`?
2. **Remote server repos:** When the server is remote (Linux), how does the user browse/select repos on that server? Need a file picker API or just text input?
3. **Worktree path template:** Should Matrix configure Worktrunk's path template, or respect the user's existing `wt.toml` config?
4. **Branch cleanup:** When `wt remove` deletes the worktree, should it also delete the remote branch (if pushed)?
