# Matrix — ACP Remote CodeAgent Control Platform

## Overview

Matrix is a remote CodeAgent control platform built on the Agent Client Protocol (ACP). Users install a server alongside ACP-compatible CodeAgents (Claude Code, Codex, etc.) on their PC or server, then connect from any device (macOS, iPhone, Android, web) via the Matrix client to remotely control their agents.

## Tech Stack

- **Monorepo**: pnpm workspace
- **Language**: TypeScript full-stack
- **Server**: Hono (HTTP + WebSocket)
- **Client**: Tauri v2 + React
- **Protocol**: Agent Client Protocol (ACP), JSON-RPC 2.0
- **Persistence**: SQLite (session history and message records)

## Package Structure

```
packages/
├── protocol/   # @matrix/protocol — ACP type definitions, zero runtime deps
├── sdk/        # @matrix/sdk — WebSocket/REST client library, framework-agnostic
├── server/     # @matrix/server — ACP agent manager, exposes API
└── client/     # @matrix/client — Tauri v2 + React app
```

| Package | Responsibility |
|---|---|
| `@matrix/protocol` | Shared ACP protocol type definitions. Zero runtime dependencies. |
| `@matrix/sdk` | Encapsulates all communication with the server (WebSocket/REST). Can be used independently of Tauri. |
| `@matrix/server` | Starts ACP agents via stdio, bridges them to clients via WebSocket + REST API. |
| `@matrix/client` | Tauri v2 + React client. Targets macOS, iOS, Android, and web. |

## Server Architecture

### Module Layout

```
@matrix/server
├── agent-manager/     # Start/stop/manage ACP agent child processes
├── acp-bridge/        # stdio ↔ JSON-RPC message conversion and routing
├── api/
│   ├── rest/          # REST endpoints (session management, history, agent list)
│   └── ws/            # WebSocket (real-time streaming, prompt, permission approval)
├── auth/              # Token auth, OAuth-ready architecture
└── store/             # Session state and history persistence (SQLite)
```

### Core Flow

1. Server starts → generates auth token, prints to console (with QR code)
2. Client connects → token verification → establish WebSocket
3. Client sends `session/new` → server starts ACP agent child process via stdio
4. Client sends prompt → server forwards to agent → agent streams `session/update` → server pushes to client via WebSocket
5. Agent initiates tool call (read file, write file, run command) → server pushes to client → user approves/rejects → server forwards result to agent

### REST API

- `GET /agents` — list available ACP agents
- `GET /sessions` — list active sessions
- `GET /sessions/:id/history` — get session history
- `POST /sessions` — create session (specify agent, cwd)
- `DELETE /sessions/:id` — close session

### Authentication

- Token-based authentication (generated on server startup)
- Architecture reserves space for OAuth extension

## SDK Design

```typescript
const client = new MatrixClient({
  serverUrl: 'https://my-server:8080',
  token: 'xxx',
  transport: 'auto', // 'websocket' | 'sse' | 'polling'
});

await client.connect();

const agents = await client.getAgents();

const session = await client.createSession({
  agentId: 'claude-code-acp',
  cwd: '/home/user/project',
});

session.prompt('Analyze this code for performance issues', {
  onMessage: (chunk) => { /* agent text output */ },
  onToolCall: (toolCall) => { /* read file, write file, etc. */ },
  onPermissionRequest: (req) => { /* needs user approval */ },
  onPlan: (plan) => { /* agent execution plan */ },
  onComplete: (result) => { /* turn ended */ },
});

session.approveToolCall(toolCallId);
session.rejectToolCall(toolCallId);

session.close();
```

### Design Principles

- Internal WebSocket auto-reconnect + heartbeat
- REST calls auto-attach token
- Event-driven, also supports async iterator for streaming consumption
- All types imported from `@matrix/protocol`

## Client Architecture

### Pages

```
Connect Page → Dashboard → Session Page
```

### Connect Page

- Input server address + token, or scan QR code to connect
- Remember connection history, auto-reconnect next time

### Dashboard

- Server status (online/offline)
- Available agent list
- Active session list (click to enter)
- Create new session button

### Session Page

```
┌─────────────────────────────────┐
│  Agent: claude-code  | cwd: /project  │
├─────────────────────────────────┤
│                                 │
│  [Plan]  Analyze code ✓        │
│          Modify files ⏳        │
│          Run tests ○            │
│                                 │
│  Agent: Let me analyze...       │
│                                 │
│  Tool Call: Read file           │
│     /src/main.ts               │
│     [Completed]                 │
│                                 │
│  Tool Call: Write file          │
│     /src/main.ts               │
│     [Approve] [Reject]         │
│                                 │
│  Agent: I've modified...        │
│                                 │
├─────────────────────────────────┤
│  [Enter message...]     [Send]  │
└─────────────────────────────────┘
```

### Key Interactions

- Agent messages display in real-time (streaming, character by character)
- Tool calls show operation type, target file, status
- Permission requests pop up approval card, support viewing diff before deciding
- Plan progress updates in real-time
- Markdown rendering for agent replies
- Responsive layout for mobile (iOS/Android)

## Data Flow

```
┌──────────┐    WebSocket/REST     ┌──────────────┐     stdio      ┌───────────┐
│          │  ◄──────────────────► │              │ ◄────────────► │           │
│  Client  │    (JSON, token auth) │    Server    │  (JSON-RPC)    │ ACP Agent │
│  (Tauri) │                       │    (Hono)    │                │(Claude等) │
└──────────┘                       └──────────────┘                └───────────┘
```

### Full Interaction Sequence

```
Client                    Server                     Agent (stdio)
  │                         │                            │
  │── POST /sessions ──────►│                            │
  │                         │── initialize ─────────────►│
  │                         │◄─ capabilities ────────────│
  │                         │── session/new ────────────►│
  │                         │◄─ sessionId ──────────────│
  │◄─ { sessionId } ───────│                            │
  │                         │                            │
  │── WS: prompt ──────────►│                            │
  │                         │── session/prompt ─────────►│
  │                         │◄─ session/update (chunk) ──│
  │◄─ WS: message_chunk ───│                            │
  │                         │◄─ session/update (tool) ───│
  │◄─ WS: tool_call ───────│                            │
  │                         │                            │
  │── WS: approve ─────────►│                            │
  │                         │── tool_call_result ───────►│
  │                         │◄─ session/update (done) ───│
  │◄─ WS: complete ────────│                            │
```

## Network Resilience

### WebSocket Reconnection

- Exponential backoff on disconnect (1s → 2s → 4s → 8s → max 30s)
- Reconnect carries `lastEventId`, server replays missed messages
- Heartbeat detection (client pings every 15s, server considers disconnected after 30s without pong)

### Server Message Buffer

- Each session maintains a bounded message queue (last 500 updates)
- Client reconnects with `lastEventId` → server replays from buffer
- If gap exceeds buffer → send full session state snapshot

### Transport Fallback

```
WebSocket (preferred)
    ↓ connection fails or blocked by firewall/proxy
SSE (degraded) — downstream via SSE streaming, upstream via HTTP POST
    ↓ SSE also unavailable
HTTP Polling (final fallback) — periodic polling, higher latency but most compatible
```

SDK auto-detects and switches transparently:

```typescript
const client = new MatrixClient({
  serverUrl: 'https://my-server:8080',
  token: 'xxx',
  transport: 'auto', // 'websocket' | 'sse' | 'polling'
});
```

### Client UI Connection Status

- Connecting / Connected / Reconnecting (attempt N) / Degraded (SSE) / Offline
- Status bar always visible so user knows current connection quality

### Error Handling

- Agent process crashes → server detects stdio close → notifies client → optional auto-restart
- Client disconnects → WebSocket auto-reconnect → resync session state
- Token expired/invalid → 401 → client redirects to connect page
