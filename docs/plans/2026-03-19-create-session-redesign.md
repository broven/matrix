# Create Session Redesign

## Goal

Simplify session creation dialog and decouple session from agent (acp-client).

## Key Concepts

### Session = Worktree (1:1)

- Session no longer binds to an agent — it only represents a git worktree
- Session status: `active` | `closed` (remove `suspended` and `restoring` — those belong to agent lifecycle)
- One session can own multiple acp-clients (agents)

### AcpClient (new concept, independent of session)

- Belongs to a session (many-to-one)
- Has its own lifecycle: spawn → active → suspended → closed
- Current phase: one active agent per session; future: multiple agents with tab switching

## Create Session Dialog

**Title**: "Create Session"

**Default view**:
- Branch name text input with git ref validation
  - Reject invalid chars: spaces, `~`, `^`, `:`, `?`, `*`, `[`, `\`, `..`, trailing `.`/`/`
  - Inline error message on invalid input
- "Create Session" button (disabled until valid branch name)

**Advanced options** (collapsed by default, chevron + divider):
- Base branch selector, defaults to repo's default branch (auto-detected)

**Removed fields**: task description, agent selector

## Session Creation Flow

1. Create git worktree — `wt switch -c {branch} --base {baseBranch} --yes` (fallback: `git worktree add`)
2. Run worktrunk hooks (setup scripts from wt.toml)
3. Store session (worktree) in DB, status = `active`
4. Navigate to session chat view (empty chat, ready for input)

No agent spawn or ACP bridge creation at this stage.

## Chat View: Lazy Agent Initialization

### Agent Selector (chat input, bottom-left)

- Current agent label → select dropdown
- Default value from server-level `defaultAgent` config
- User can switch before sending a message

### First Message Flow

1. Read selected agent from the dropdown
2. Spawn agent process in worktree directory
3. Create ACP bridge — initialize protocol handshake, `session/new`
4. Send user message as first prompt
5. Create acp-client record in DB, associated with current session

### Subsequent Messages

Bridge already established — send prompts directly.

### Error Handling

Agent spawn failure → inline error in chat, allow retry.

## Server Settings

New field per server: `defaultAgent`
- Dropdown listing all available agents for that server
- Saved to server config
- Used as default selection in chat view agent selector
