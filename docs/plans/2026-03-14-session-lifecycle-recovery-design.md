# Session Lifecycle Recovery Design

**Goal:** Preserve recoverable sessions across server restarts, suspend idle recoverable sessions after 30 minutes, and transparently restore them on the next user prompt while keeping non-recoverable sessions simple and explicit.

**Summary:** The current system persists session history in SQLite, but runtime session bridges only exist in memory. This design separates persisted session lifecycle from live agent resources by introducing explicit session states, persisted restore metadata, idle suspension for recoverable agents only, and lazy restoration on demand.

---

## Context

Today the server stores session rows and history rows in SQLite, but active bridges only live in `SessionManager` memory. After a server restart, the client can still list historical sessions from the database, but those sessions have no live bridge behind them. A prompt sent to such a session is silently ignored by the server, and the client stays in loading state because it never receives a terminal update.

The desired behavior is:

- Recoverable sessions survive server restarts and remain usable.
- Recoverable sessions free runtime memory after 30 minutes of inactivity.
- A suspended recoverable session is automatically restored when the user sends a new prompt.
- Non-recoverable sessions never enter suspended state.
- Non-recoverable sessions become closed after restart or unrecoverable process loss.

## Requirements

- Only agents that support native session loading may be suspended and restored.
- Idle timeout is 30 minutes without new user or agent activity.
- History remains readable for all sessions, including suspended and closed sessions.
- Sending a prompt to a suspended session must restore it before forwarding the prompt.
- Sending a prompt to a closed or unrecoverable session must return a concrete error.
- The client must show suspended, restoring, active, and closed states instead of hanging indefinitely.

## State Model

Persisted session state expands from a simple `active/closed` model to:

- `active`: live bridge exists in memory and can process prompts immediately.
- `suspended`: no live bridge in memory, but the session can be restored because the agent supports native load.
- `restoring`: the server is currently rebuilding the bridge for a suspended session.
- `closed`: terminal state for deleted, unrecoverable, or non-recoverable sessions after restart.

State transitions:

- New recoverable session: `active`
- New non-recoverable session: `active`
- Recoverable idle timeout after 30 minutes: `active -> suspended`
- Recoverable session receives prompt while suspended: `suspended -> restoring -> active`
- Recoverable restore failure: `restoring -> closed`
- Non-recoverable session loses process or server restarts: `active -> closed`
- User delete: `active|suspended|restoring -> closed`

## Recoverability Rules

Recoverability is capability-driven and must be stored on each session row at creation time.

- If an agent advertises `loadSession`, the session is marked `recoverable = true`.
- If an agent does not advertise `loadSession`, the session is marked `recoverable = false`.
- Only `recoverable = true` sessions may be suspended.
- On server startup:
  - recoverable non-closed sessions are normalized to `suspended`
  - non-recoverable non-closed sessions are normalized to `closed`

This keeps restart behavior deterministic and prevents the UI from treating dead sessions as live.

## Persistence Model

The `sessions` table needs more than the current metadata to support suspend and restore.

New or expanded persisted fields:

- `status`: `active | suspended | restoring | closed`
- `recoverable`: boolean
- `agent_session_id`: the agent-native session identifier returned by ACP
- `last_active_at`: updated on any user prompt or agent update
- `suspended_at`: nullable, for observability and cleanup logic
- `close_reason`: nullable, for diagnostics and UI messaging

Existing history storage remains valid and should not change structurally, aside from ensuring timestamps remain available for replay and UI rendering.

## Server Architecture

### Session creation

When creating a session, the server should:

1. Spawn the agent process.
2. Initialize ACP.
3. Read capabilities and derive whether `loadSession` is supported.
4. Create a new ACP session.
5. Persist:
   - Matrix session ID
   - agent ID
   - cwd
   - `agent_session_id`
   - `recoverable`
   - `status = active`
   - `last_active_at = now`
6. Register the bridge in `SessionManager`.

### Idle suspension

Add a background sweep on the server that runs periodically, for example once per minute, and:

- finds sessions where:
  - `recoverable = true`
  - `status = active`
  - `last_active_at < now - 30 minutes`
- destroys the live bridge
- removes the bridge from `SessionManager`
- updates `status = suspended`
- sets `suspended_at = now`
- broadcasts a transport event so connected clients update immediately

Non-recoverable sessions are excluded from this sweep entirely.

### Restart normalization

On server boot, after opening the store and registering agents:

- scan all non-closed sessions
- for `recoverable = true`, set `status = suspended`
- for `recoverable = false`, set `status = closed` with `close_reason = server_restart_unrecoverable`

This avoids pretending that runtime resources survived a process restart.

### Lazy restoration on prompt

Prompt handling must become state-aware.

Current behavior is effectively:

- lookup bridge
- if found, send prompt
- if not found, do nothing

New behavior should be:

1. Load the persisted session row.
2. If `status = closed`, return an explicit error.
3. If `status = active`, use the existing bridge.
4. If `status = suspended`, atomically transition to `restoring` and rebuild the bridge using the stored `agent_session_id`.
5. On successful restore:
   - register the new bridge
   - set `status = active`
   - clear `suspended_at`
   - update `last_active_at`
   - send the prompt
6. On restore failure:
   - set `status = closed`
   - persist `close_reason = restore_failed`
   - return an explicit error to the client

To make this work, the ACP bridge layer must support loading an existing session rather than always calling `session/new`.

### Agent crash handling

Runtime crash policy should split by recoverability:

- recoverable sessions:
  - keep the existing in-process restart attempts
  - if restart limit is exceeded, transition to `suspended` instead of immediately `closed` if the agent can still be restored later
  - if restoration metadata is invalid, fall back to `closed`
- non-recoverable sessions:
  - keep existing restart attempts if desired for transient failure handling
  - once the session cannot be kept alive, set `closed`

This preserves the ability to continue a recoverable session without holding memory forever.

## ACP Bridge Changes

`AcpBridge` currently stores the agent-native session ID returned by `session/new`, but only exposes create-session flow. It needs a load-session path.

Required changes:

- expose ACP initialize result so capability detection is possible
- add a method such as `loadSession(agentSessionId, cwd)` or equivalent ACP request
- ensure the bridge uses the restored `agent_session_id` for subsequent `session/prompt`
- keep Matrix session ID separate from agent-native session ID

If the ACP server rejects load for a stored `agent_session_id`, the server must treat that as a terminal restore failure and close the Matrix session.

## Client Behavior

The client must stop treating all selected sessions as interchangeable live sessions.

Expected UI states:

- `active`: normal chat behavior
- `suspended`: history is readable, prompt input remains enabled, next send triggers restore flow
- `restoring`: input disabled, status bar shows restore-in-progress
- `closed`: history remains readable, input disabled, explicit explanation shown

Required client changes:

- include persisted session status in session list and session header
- replace the current `isProcessing`-only model with separate lifecycle state and prompt state
- terminate loading on:
  - prompt completion
  - restore failure
  - session-closed error
  - prompt rejection due to unavailable session
- show a concrete error message instead of leaving the user in indefinite loading

## Transport Changes

The transport layer should explicitly carry lifecycle events or error payloads rather than relying on silent no-op behavior.

Recommended additions:

- `session:suspended`
- `session:restoring`
- expanded `session:closed` with an optional reason
- prompt-level error response for restore failure or closed-session prompt attempts

If protocol expansion is kept minimal, the server may reuse `session:snapshot` plus `error`, but explicit lifecycle messages are cleaner and easier to render correctly in the client.

## Data Freshness

`last_active_at` should update on:

- any accepted user prompt
- any agent message chunk
- tool call updates
- permission requests
- completion events

This prevents a long-running active turn from being incorrectly suspended just because the user has not typed again.

## Concurrency and Safety

Restoration must be serialized per session.

- If two prompts arrive for the same suspended session concurrently, only one restore should happen.
- The second prompt should either wait for the restore to complete or fail fast with a clear retryable error.
- `SessionManager` should guard against double-registration and duplicate restores.

Idle suspension must also avoid racing with an in-flight prompt.

- Do not suspend a session while a prompt is actively running.
- Track active prompt count or prompt-in-progress flag in memory for active bridges.

## Migration Strategy

Database migration should:

- add the new columns to `sessions`
- map existing `status = active` rows to:
  - `recoverable = false` by default until capability is known
  - `agent_session_id = null`
  - `last_active_at = created_at` or latest known history timestamp
- after deployment, newly created sessions will begin storing full recovery metadata

Existing sessions without `agent_session_id` cannot be truly restored. On first startup after migration:

- if such a session is non-closed, convert it to `closed`
- preserve history
- optionally set `close_reason = migration_missing_restore_metadata`

## Testing Strategy

### Store and migration tests

- adds new session columns correctly
- upgrades older databases without losing history
- normalizes restart state correctly

### Session manager tests

- suspends only recoverable idle sessions
- never suspends non-recoverable sessions
- restores a suspended session on prompt
- rejects prompt to a closed session
- serializes concurrent restore attempts

### Bridge tests

- captures `agent_session_id` on create
- loads an existing agent session successfully
- propagates load failure cleanly

### Integration tests

- create recoverable session, suspend it, prompt again, verify restore then response
- restart server, verify recoverable session becomes suspended and can be restored
- restart server, verify non-recoverable session becomes closed
- verify client history remains visible for suspended and closed sessions
- verify restore failure ends loading and shows an error

## Rollout Notes

This feature changes lifecycle semantics and should ship with strong diagnostics:

- log every state transition with session ID and reason
- expose close and restore failure reasons in the database
- keep the initial implementation conservative:
  - lazy restore only
  - periodic idle sweep
  - no eager prewarming of sessions

That gives the desired user behavior while minimizing persistent runtime memory.
