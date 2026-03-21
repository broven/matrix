# Multi-Server Architecture & Settings Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support simultaneous connections to multiple Matrix Servers with per-server settings pages, real-time sync across devices, and automatic recovery after sleep.

**Architecture:** Bottom-up approach — protocol types first, then SDK ClientManager, React multi-client context, per-server data hooks, server-side broadcast, sidebar restructure, settings UI, and finally e2e tests.

**Tech Stack:** TypeScript, React, Hono (server), WebSocket, Vitest, Tauri

**Design doc:** `docs/plans/2026-03-21-multi-server-settings-design.md`

---

### Task 1: Protocol — Add Server-Level Event Types

**Files:**
- Modify: `packages/protocol/src/transport.ts`

**Step 1: Add server-level events to ServerMessage type**

In `packages/protocol/src/transport.ts`, add new server-level event variants to the `ServerMessage` union type. These are incremental push events (best-effort, no eventId replay). Add them after the existing `session:closed` variant:

```typescript
import type { SessionUpdate, SessionModes, PermissionOutcome } from "./session.js";
import type { HistoryEntry, SessionInfo, AgentListItem } from "./api.js";
import type { RepositoryInfo } from "./repository.js";

/** Transport mode for client-server communication */
export type TransportMode = "websocket" | "sse" | "polling" | "auto";

/** Connection status */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "degraded"
  | "offline";

/** WebSocket message envelope from server to client */
export type ServerMessage =
  | { type: "session:update"; sessionId: string; update: SessionUpdate; eventId: string }
  | { type: "session:snapshot"; sessionId: string; history: HistoryEntry[]; eventId: string }
  | { type: "session:suspended"; sessionId: string; eventId: string }
  | { type: "session:restoring"; sessionId: string; eventId: string }
  | { type: "session:created"; sessionId: string; modes: SessionModes }
  | { type: "session:closed"; sessionId: string; reason?: string }
  | { type: "error"; code: string; message: string; sessionId?: string }
  // Server-level events (incremental, best-effort delivery)
  | { type: "server:session_created"; session: SessionInfo }
  | { type: "server:session_closed"; sessionId: string }
  | { type: "server:repository_added"; repository: RepositoryInfo }
  | { type: "server:repository_removed"; repositoryId: string };

/** WebSocket message envelope from client to server */
export type ClientMessage =
  | { type: "session:prompt"; sessionId: string; prompt: Array<{ type: string; text: string }> }
  | { type: "session:cancel"; sessionId: string }
  | { type: "session:subscribe"; sessionId: string; lastEventId?: string }
  | { type: "session:permission_response"; sessionId: string; toolCallId: string; outcome: PermissionOutcome }
  | { type: "ping" };
```

**Step 2: Run type check to verify**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: PASS (no downstream consumers of the new types yet)

**Step 3: Commit**

```bash
git add packages/protocol/src/transport.ts
git commit -m "feat(protocol): add server-level event types for multi-client sync"
```

---

### Task 2: Server — Add broadcastToAll to ConnectionManager

**Files:**
- Modify: `packages/server/src/api/ws/connection-manager.ts`

**Step 1: Add broadcastToAll method**

Add this method to the `ConnectionManager` class after `broadcastToSession` (after line 62):

```typescript
  /** Broadcast a server-level event to all connected clients (no eventId, no buffering). */
  broadcastToAll(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const [, conn] of this.connections) {
      conn.sender.send(data);
    }
  }
```

**Step 2: Run type check**

Run: `cd packages/server && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/server/src/api/ws/connection-manager.ts
git commit -m "feat(server): add broadcastToAll for server-level events"
```

---

### Task 3: Server — Broadcast Events from REST Routes

**Files:**
- Modify: `packages/server/src/api/rest/index.ts`
- Modify: `packages/server/src/api/rest/sessions.ts`
- Modify: `packages/server/src/api/rest/repositories.ts`

**Step 1: Pass connectionManager to REST routes**

In `packages/server/src/api/rest/index.ts`, add `connectionManager` to the deps interface and pass it to route factories:

```typescript
import { Hono } from "hono";
import type { AgentManager } from "../../agent-manager/index.js";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import type { WorktreeManager } from "../../worktree-manager/index.js";
import type { CloneManager } from "../../clone-manager/index.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import { agentRoutes } from "./agents.js";
import { sessionRoutes } from "./sessions.js";
import { repositoryRoutes } from "./repositories.js";
import { filesystemRoutes } from "./filesystem.js";
import { serverConfigRoutes } from "./server-config.js";
import { customAgentRoutes } from "./custom-agents.js";

interface RestRouteDeps {
  agentManager: AgentManager;
  store: Store;
  sessionManager: SessionManager;
  worktreeManager: WorktreeManager;
  cloneManager: CloneManager;
  connectionManager: ConnectionManager;
  onAgentConfigChange: () => void;
}

export function createRestRoutes(deps: RestRouteDeps) {
  const app = new Hono();
  app.route("/", agentRoutes(deps.agentManager));
  app.route("/", sessionRoutes(deps.store, deps.sessionManager, deps.connectionManager));
  app.route("/", repositoryRoutes({
    store: deps.store,
    sessionManager: deps.sessionManager,
    worktreeManager: deps.worktreeManager,
    cloneManager: deps.cloneManager,
    connectionManager: deps.connectionManager,
  }));
  app.route("/", filesystemRoutes());
  app.route("/", serverConfigRoutes());
  app.route("/", customAgentRoutes({
    store: deps.store,
    agentManager: deps.agentManager,
    onConfigChange: deps.onAgentConfigChange,
  }));
  return app;
}
```

**Step 2: Add broadcasts to session routes**

In `packages/server/src/api/rest/sessions.ts`, add `connectionManager` parameter and broadcast on delete:

```typescript
import { Hono } from "hono";
import type { Store } from "../../store/index.js";
import type { SessionManager } from "../../session-manager/index.js";
import type { ConnectionManager } from "../ws/connection-manager.js";

export function sessionRoutes(store: Store, sessionManager: SessionManager, connectionManager: ConnectionManager) {
  const app = new Hono();

  app.get("/sessions", (c) => {
    return c.json(store.listSessions());
  });

  app.get("/sessions/:id/history", (c) => {
    const sessionId = c.req.param("id");
    const sessions = store.listSessions();
    const exists = sessions.some((s) => s.sessionId === sessionId);
    if (!exists) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json(store.getHistory(sessionId));
  });

  app.post("/sessions/:id/cancel", (c) => {
    const sessionId = c.req.param("id");
    sessionManager.cancelPrompt(sessionId);
    return c.json({ ok: true });
  });

  app.delete("/sessions/:id", (c) => {
    const sessionId = c.req.param("id");
    sessionManager.closeSession(sessionId, store);
    store.deleteSession(sessionId);
    connectionManager.broadcastToAll({ type: "server:session_closed", sessionId });
    return c.json({ ok: true });
  });

  return app;
}
```

**Step 3: Add broadcasts to repository routes**

In `packages/server/src/api/rest/repositories.ts`, add `connectionManager` to deps and broadcast on create/delete:

Add `ConnectionManager` import and add it to the deps interface:

```typescript
import type { ConnectionManager } from "../ws/connection-manager.js";

interface RepositoryRouteDeps {
  store: Store;
  sessionManager: SessionManager;
  worktreeManager: WorktreeManager;
  cloneManager: CloneManager;
  connectionManager: ConnectionManager;
}
```

Then destructure it:
```typescript
export function repositoryRoutes(deps: RepositoryRouteDeps) {
  const { store, sessionManager, worktreeManager, cloneManager, connectionManager } = deps;
```

After `return c.json(repo, 201);` in `POST /repositories` (line 55), add broadcast before the return:
```typescript
    connectionManager.broadcastToAll({ type: "server:repository_added", repository: repo });
    return c.json(repo, 201);
```

After `store.deleteRepository(id);` in `DELETE /repositories/:id` (line 123), add broadcast before the return:
```typescript
    store.deleteRepository(id);
    connectionManager.broadcastToAll({ type: "server:repository_removed", repositoryId: id });
    return c.json({ ok: true });
```

Also broadcast for clone completion — in the clone `onComplete` callback (around line 291), after `job.repositoryId = repo.id;`:
```typescript
              job.repositoryId = repo.id;
              connectionManager.broadcastToAll({ type: "server:repository_added", repository: repo });
```

**Step 4: Update server index.ts to pass connectionManager to REST routes**

In `packages/server/src/index.ts`, find where `createRestRoutes` is called and add `connectionManager` to the deps object. Search for `createRestRoutes` and add `connectionManager` to the object literal.

**Step 5: Run type check**

Run: `cd packages/server && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/server/src/api/rest/index.ts packages/server/src/api/rest/sessions.ts packages/server/src/api/rest/repositories.ts packages/server/src/index.ts
git commit -m "feat(server): broadcast server-level events on session/repo changes"
```

---

### Task 4: Server — Broadcast session_created on Lazy Session Creation

**Files:**
- Modify: `packages/server/src/index.ts`

Session creation happens in two places:
1. `POST /repositories/:repoId/worktrees` (creates session as part of worktree creation) — in `repositories.ts`
2. Lazy session creation during prompt handling in `index.ts`

**Step 1: Broadcast in worktree creation route**

In `packages/server/src/api/rest/repositories.ts`, in the `POST /repositories/:repoId/worktrees` handler, after the session is created (after `store.createSession(sessionId, null, worktreePath, {...})`), add:

```typescript
      const sessionInfo = store.listSessions().find(s => s.sessionId === sessionId);
      if (sessionInfo) {
        connectionManager.broadcastToAll({ type: "server:session_created", session: sessionInfo });
      }
```

**Step 2: Run type check**

Run: `cd packages/server && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/server/src/api/rest/repositories.ts
git commit -m "feat(server): broadcast session_created on worktree creation"
```

---

### Task 5: SDK — Add onServerEvent to MatrixClient

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`

**Step 1: Add server event types and listener to MatrixClient**

In `packages/sdk/src/client.ts`, add a `ServerEvent` type and `onServerEvent` method. Also update `handleServerMessage` to dispatch server-level events.

Add at the top of the file (after imports):

```typescript
import type { ServerMessage, SessionInfo, AgentListItem, RepositoryInfo } from "@matrix/protocol";

/** Server-level events for multi-client sync */
export type ServerEvent =
  | { type: "server:session_created"; session: SessionInfo }
  | { type: "server:session_closed"; sessionId: string }
  | { type: "server:repository_added"; repository: RepositoryInfo }
  | { type: "server:repository_removed"; repositoryId: string };
```

Add to the `MatrixClient` class:

```typescript
  private serverEventListeners = new Set<(event: ServerEvent) => void>();

  /** Subscribe to server-level events (session/repo changes from other clients). */
  onServerEvent(callback: (event: ServerEvent) => void): () => void {
    this.serverEventListeners.add(callback);
    return () => { this.serverEventListeners.delete(callback); };
  }
```

In the `handleServerMessage` method, add handling for server-level event types. After the existing cases in the switch/if chain, add:

```typescript
    if (
      msg.type === "server:session_created" ||
      msg.type === "server:session_closed" ||
      msg.type === "server:repository_added" ||
      msg.type === "server:repository_removed"
    ) {
      for (const listener of this.serverEventListeners) {
        listener(msg as ServerEvent);
      }
      return;
    }
```

**Step 2: Export ServerEvent from SDK**

In `packages/sdk/src/index.ts`, add `ServerEvent` to the exports from `./client.js`:

```typescript
export { MatrixClient, type MatrixClientConfig, type ServerEvent } from "./client.js";
```

**Step 3: Run type check**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): add onServerEvent for server-level event subscription"
```

---

### Task 6: SDK — Create ClientManager

**Files:**
- Create: `packages/sdk/src/client-manager.ts`
- Modify: `packages/sdk/src/index.ts`

**Step 1: Create ClientManager class**

Create `packages/sdk/src/client-manager.ts`:

```typescript
import { MatrixClient, type MatrixClientConfig } from "./client.js";
import type { ConnectionStatus } from "@matrix/protocol";

export interface ServerConnection {
  serverId: string;
  serverUrl: string;
  token: string;
}

type StatusListener = (serverId: string, status: ConnectionStatus) => void;
type ErrorListener = (serverId: string, error: Error) => void;

/**
 * Manages multiple MatrixClient instances for simultaneous server connections.
 * Each server gets its own independent client with its own transport.
 */
export class ClientManager {
  private clients = new Map<string, MatrixClient>();
  private statusListeners = new Set<StatusListener>();
  private errorListeners = new Set<ErrorListener>();

  /** Connect to a server. If already connected, returns existing client. */
  connect(serverId: string, config: { serverUrl: string; token: string }): MatrixClient {
    const existing = this.clients.get(serverId);
    if (existing) {
      return existing;
    }

    const client = new MatrixClient({
      serverUrl: config.serverUrl,
      token: config.token,
    });

    client.onStatusChange((status) => {
      for (const listener of this.statusListeners) {
        listener(serverId, status);
      }
    });

    client.onError((error) => {
      for (const listener of this.errorListeners) {
        listener(serverId, error);
      }
    });

    this.clients.set(serverId, client);
    client.connect();
    return client;
  }

  /** Disconnect a specific server. */
  disconnect(serverId: string): void {
    const client = this.clients.get(serverId);
    if (client) {
      client.disconnect();
      this.clients.delete(serverId);
    }
  }

  /** Get client for a specific server. */
  getClient(serverId: string): MatrixClient | null {
    return this.clients.get(serverId) ?? null;
  }

  /** Get all connected clients. */
  getConnectedClients(): Map<string, MatrixClient> {
    return new Map(this.clients);
  }

  /** Disconnect all servers. */
  disconnectAll(): void {
    for (const [id, client] of this.clients) {
      client.disconnect();
    }
    this.clients.clear();
  }

  /** Register a status change listener for any server. */
  onStatusChange(callback: StatusListener): () => void {
    this.statusListeners.add(callback);
    return () => { this.statusListeners.delete(callback); };
  }

  /** Register an error listener for any server. */
  onError(callback: ErrorListener): () => void {
    this.errorListeners.add(callback);
    return () => { this.errorListeners.delete(callback); };
  }
}
```

**Step 2: Export from SDK**

In `packages/sdk/src/index.ts`, add:

```typescript
export { ClientManager, type ServerConnection } from "./client-manager.js";
```

**Step 3: Run type check**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/sdk/src/client-manager.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): add ClientManager for multi-server connections"
```

---

### Task 7: Client — Create useMatrixClients Multi-Client Provider

**Files:**
- Create: `packages/client/src/hooks/useMatrixClients.tsx`
- Modify: `packages/client/src/hooks/useMatrixClient.tsx`

**Step 1: Create multi-client provider**

Create `packages/client/src/hooks/useMatrixClients.tsx`:

```typescript
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ClientManager, MatrixClient } from "@matrix/sdk";
import type { ConnectionStatus } from "@matrix/protocol";

interface MatrixClientsContextValue {
  /** All connected clients keyed by serverId */
  clients: Map<string, MatrixClient>;
  /** Connection status per server */
  statuses: Map<string, ConnectionStatus>;
  /** Connection error per server */
  errors: Map<string, string | null>;
  /** Connect to a server */
  connect(serverId: string, config: { serverUrl: string; token: string }): Promise<void>;
  /** Disconnect from a server */
  disconnect(serverId: string): void;
  /** Get client for a specific server */
  getClient(serverId: string): MatrixClient | null;
}

const MatrixClientsContext = createContext<MatrixClientsContextValue>({
  clients: new Map(),
  statuses: new Map(),
  errors: new Map(),
  connect: async () => {},
  disconnect: () => {},
  getClient: () => null,
});

export function useMatrixClients() {
  return useContext(MatrixClientsContext);
}

/** Get client + status for a specific server */
export function useServerClient(serverId: string) {
  const { getClient, statuses, errors } = useMatrixClients();
  return {
    client: getClient(serverId),
    status: statuses.get(serverId) ?? ("offline" as ConnectionStatus),
    error: errors.get(serverId) ?? null,
  };
}

export function MatrixClientsProvider({ children }: { children: ReactNode }) {
  const managerRef = useRef(new ClientManager());
  const [clients, setClients] = useState<Map<string, MatrixClient>>(new Map());
  const [statuses, setStatuses] = useState<Map<string, ConnectionStatus>>(new Map());
  const [errors, setErrors] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    const manager = managerRef.current;
    const unsubStatus = manager.onStatusChange((serverId, status) => {
      setStatuses((prev) => new Map(prev).set(serverId, status));
    });
    const unsubError = manager.onError((serverId, error) => {
      setErrors((prev) => new Map(prev).set(serverId, error.message));
    });
    return () => {
      unsubStatus();
      unsubError();
      manager.disconnectAll();
    };
  }, []);

  const connect = useCallback(async (serverId: string, config: { serverUrl: string; token: string }) => {
    const manager = managerRef.current;
    setStatuses((prev) => new Map(prev).set(serverId, "connecting"));
    setErrors((prev) => new Map(prev).set(serverId, null));
    try {
      const client = manager.connect(serverId, config);
      setClients(new Map(manager.getConnectedClients()));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setErrors((prev) => new Map(prev).set(serverId, message));
    }
  }, []);

  const disconnect = useCallback((serverId: string) => {
    managerRef.current.disconnect(serverId);
    setClients(new Map(managerRef.current.getConnectedClients()));
    setStatuses((prev) => {
      const next = new Map(prev);
      next.set(serverId, "offline");
      return next;
    });
  }, []);

  const getClient = useCallback((serverId: string) => {
    return managerRef.current.getClient(serverId);
  }, []);

  return (
    <MatrixClientsContext.Provider value={{ clients, statuses, errors, connect, disconnect, getClient }}>
      {children}
    </MatrixClientsContext.Provider>
  );
}
```

**Step 2: Refactor useMatrixClient to delegate to useMatrixClients**

Modify `packages/client/src/hooks/useMatrixClient.tsx` to keep backward compatibility. For this phase, we keep the old single-client provider working alongside the new multi-client provider. The old provider continues to work for components not yet migrated. The new `useServerClient(serverId)` hook is used by new/migrated components.

No changes needed to `useMatrixClient.tsx` at this stage — it continues to function as-is for the local sidecar connection. Components that need multi-server awareness will use `useMatrixClients()` or `useServerClient(serverId)` directly.

**Step 3: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/client/src/hooks/useMatrixClients.tsx
git commit -m "feat(client): add MatrixClientsProvider for multi-server connections"
```

---

### Task 8: Client — Create useServerData Hook

**Files:**
- Create: `packages/client/src/hooks/useServerData.tsx`

**Step 1: Create the hook**

Create `packages/client/src/hooks/useServerData.tsx`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentListItem, SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import type { ServerConfig } from "@matrix/protocol";
import type { ServerEvent } from "@matrix/sdk";
import { useMatrixClients } from "./useMatrixClients";

export interface ServerData {
  agents: AgentListItem[];
  sessions: SessionInfo[];
  repositories: RepositoryInfo[];
  worktrees: Map<string, WorktreeInfo[]>;
  serverConfig: ServerConfig | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads and manages all data for a specific server.
 * Subscribes to incremental server events and handles full refresh on reconnect.
 */
export function useServerData(serverId: string): ServerData {
  const { getClient, statuses } = useMatrixClients();
  const status = statuses.get(serverId);

  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [repositories, setRepositories] = useState<RepositoryInfo[]>([]);
  const [worktrees, setWorktrees] = useState<Map<string, WorktreeInfo[]>>(new Map());
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const prevStatusRef = useRef(status);

  /** Full data refresh from server REST APIs */
  const refreshAll = useCallback(async () => {
    const client = getClient(serverId);
    if (!client) return;

    try {
      setLoading(true);
      const [agentList, sessionList, repoList, config] = await Promise.all([
        client.getAgents(),
        client.getSessions(),
        client.getRepositories(),
        client.getServerConfig(),
      ]);

      setAgents(agentList);
      setSessions(sessionList);
      setRepositories(repoList);
      setServerConfig(config);

      // Load worktrees for each repo
      const wtMap = new Map<string, WorktreeInfo[]>();
      await Promise.all(
        repoList.map(async (repo) => {
          try {
            const wts = await client.getWorktrees(repo.id);
            wtMap.set(repo.id, wts);
          } catch {
            wtMap.set(repo.id, []);
          }
        }),
      );
      setWorktrees(wtMap);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load server data");
    } finally {
      setLoading(false);
    }
  }, [serverId, getClient]);

  // Full refresh when status changes to "connected"
  useEffect(() => {
    const wasConnected = prevStatusRef.current === "connected";
    prevStatusRef.current = status;

    if (status === "connected") {
      refreshAll();
    }
  }, [status, refreshAll]);

  // Subscribe to incremental server events
  useEffect(() => {
    const client = getClient(serverId);
    if (!client) return;

    const unsub = client.onServerEvent((event: ServerEvent) => {
      switch (event.type) {
        case "server:session_created":
          setSessions((prev) => [...prev, event.session]);
          break;
        case "server:session_closed":
          setSessions((prev) => prev.filter((s) => s.sessionId !== event.sessionId));
          break;
        case "server:repository_added":
          setRepositories((prev) => [...prev, event.repository]);
          break;
        case "server:repository_removed":
          setRepositories((prev) => prev.filter((r) => r.id !== event.repositoryId));
          setWorktrees((prev) => {
            const next = new Map(prev);
            next.delete(event.repositoryId);
            return next;
          });
          break;
      }
    });

    return unsub;
  }, [serverId, getClient]);

  // Visibility change → full refresh (sleep recovery)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible" && status === "connected") {
        refreshAll();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [status, refreshAll]);

  return { agents, sessions, repositories, worktrees, serverConfig, loading, error };
}
```

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/client/src/hooks/useServerData.tsx
git commit -m "feat(client): add useServerData hook with incremental sync and recovery"
```

---

### Task 9: Client — Create useConnectionRecovery Hook

**Files:**
- Create: `packages/client/src/hooks/useConnectionRecovery.tsx`

**Step 1: Create recovery hook**

Create `packages/client/src/hooks/useConnectionRecovery.tsx`:

```typescript
import { useEffect } from "react";
import { useMatrixClients } from "./useMatrixClients";
import { useServerStore } from "./useServerStore";

/**
 * Handles connection lifecycle:
 * - On mount: connects to all saved servers in parallel
 * - On visibility change: triggers reconnection for offline servers
 */
export function useConnectionRecovery() {
  const { connect, statuses } = useMatrixClients();
  const { servers } = useServerStore();

  // Connect to all saved servers on mount
  useEffect(() => {
    for (const server of servers) {
      connect(server.id, {
        serverUrl: server.serverUrl,
        token: server.token,
      });
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On visibility restore, reconnect any offline servers
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "visible") return;

      for (const server of servers) {
        const status = statuses.get(server.id);
        if (status === "offline" || !status) {
          connect(server.id, {
            serverUrl: server.serverUrl,
            token: server.token,
          });
        }
      }
    };

    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [servers, statuses, connect]);
}
```

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/client/src/hooks/useConnectionRecovery.tsx
git commit -m "feat(client): add useConnectionRecovery for auto-connect and sleep recovery"
```

---

### Task 10: Client — Update Settings Sidebar with Server Tabs

**Files:**
- Modify: `packages/client/src/pages/settings/SettingsSidebar.tsx`

**Step 1: Update SettingsTab type and sidebar layout**

Rewrite `packages/client/src/pages/settings/SettingsSidebar.tsx` to include server list and remove agents tab:

```typescript
import type { RepositoryInfo } from "@matrix/protocol";
import type { SavedServer } from "../../hooks/useServerStore";
import type { ConnectionStatus } from "@matrix/protocol";
import { cn } from "../../lib/utils";

export type SettingsTab =
  | { kind: "general" }
  | { kind: "server"; serverId: string }
  | { kind: "new-server" }
  | { kind: "repository"; repositoryId: string };

interface SettingsSidebarProps {
  repositories: RepositoryInfo[];
  servers: SavedServer[];
  serverStatuses: Map<string, ConnectionStatus>;
  selectedTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
}

function StatusDot({ status }: { status: ConnectionStatus | undefined }) {
  const color =
    status === "connected"
      ? "bg-green-500"
      : status === "connecting" || status === "reconnecting"
        ? "bg-yellow-500"
        : status === "degraded"
          ? "bg-orange-500"
          : "bg-gray-400";
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}

export function SettingsSidebar({
  repositories,
  servers,
  serverStatuses,
  selectedTab,
  onSelectTab,
}: SettingsSidebarProps) {
  const isSelected = (tab: SettingsTab) => {
    if (tab.kind !== selectedTab.kind) return false;
    if (tab.kind === "server" && selectedTab.kind === "server") return tab.serverId === selectedTab.serverId;
    if (tab.kind === "repository" && selectedTab.kind === "repository") return tab.repositoryId === selectedTab.repositoryId;
    return true;
  };

  return (
    <aside
      className="flex w-full shrink-0 flex-col border-r border-border bg-muted/20 md:w-[260px]"
      data-testid="settings-sidebar"
    >
      <div className="flex-1 overflow-y-auto p-2">
        {/* General */}
        <button
          className={cn(
            "w-full rounded-md px-3 py-1.5 text-left text-sm",
            isSelected({ kind: "general" }) ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
          onClick={() => onSelectTab({ kind: "general" })}
          data-testid="settings-general-tab"
        >
          General
        </button>

        {/* Servers */}
        <div className="mt-4">
          <span className="px-3 text-xs font-medium text-muted-foreground">Servers</span>
          <div className="mt-1 space-y-0.5">
            {servers.map((server) => (
              <button
                key={server.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm",
                  isSelected({ kind: "server", serverId: server.id })
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                onClick={() => onSelectTab({ kind: "server", serverId: server.id })}
                data-testid={`settings-server-tab-${server.id}`}
              >
                <StatusDot status={serverStatuses.get(server.id)} />
                <span className="truncate">{server.name}</span>
              </button>
            ))}
            <button
              className="w-full rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/50"
              onClick={() => onSelectTab({ kind: "new-server" })}
              data-testid="settings-add-server-btn"
            >
              Add Server...
            </button>
          </div>
        </div>

        {/* Repositories */}
        {repositories.length > 0 && (
          <div className="mt-4">
            <span className="px-3 text-xs font-medium text-muted-foreground">Repositories</span>
            <div className="mt-1 space-y-0.5">
              {repositories.map((repo) => (
                <button
                  key={repo.id}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm",
                    isSelected({ kind: "repository", repositoryId: repo.id })
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => onSelectTab({ kind: "repository", repositoryId: repo.id })}
                  data-testid={`settings-repo-tab-${repo.id}`}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-medium">
                    {repo.name[0]?.toUpperCase()}
                  </span>
                  <span className="truncate">{repo.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
```

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: May have errors in SettingsPage.tsx due to changed props — those will be fixed in Task 11.

**Step 3: Commit**

```bash
git add packages/client/src/pages/settings/SettingsSidebar.tsx
git commit -m "feat(client): redesign settings sidebar with server list and status dots"
```

---

### Task 11: Client — Create SettingsServerTab Component

**Files:**
- Create: `packages/client/src/pages/settings/SettingsServerTab.tsx`

**Step 1: Create server settings tab**

This component renders the per-server configuration page with 4 cards: Connection, Server Configuration, Agents, and Danger Zone. It reuses the existing `SettingsAgentsTab` content for the agents section.

Create `packages/client/src/pages/settings/SettingsServerTab.tsx`:

```typescript
import { useCallback, useEffect, useState } from "react";
import type { SavedServer } from "../../hooks/useServerStore";
import type { AgentListItem, ServerConfig, ConnectionStatus } from "@matrix/protocol";
import type { MatrixClient } from "@matrix/sdk";
import { useServerClient } from "../../hooks/useMatrixClients";
import { useMatrixClients } from "../../hooks/useMatrixClients";
import { useServerStore } from "../../hooks/useServerStore";
import { SettingsAgentsTab } from "./SettingsAgentsTab";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { AlertCircle, CheckCircle2, Loader2, Trash2, Unplug, Plug } from "lucide-react";

interface SettingsServerTabProps {
  server: SavedServer;
}

export function SettingsServerTab({ server }: SettingsServerTabProps) {
  const { client, status, error } = useServerClient(server.id);
  const { connect, disconnect } = useMatrixClients();
  const { updateServer, removeServer } = useServerStore();

  const [name, setName] = useState(server.name);
  const [url, setUrl] = useState(server.serverUrl);
  const [token, setToken] = useState(server.token);

  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [reposPath, setReposPath] = useState("");
  const [worktreesPath, setWorktreesPath] = useState("");

  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load server config and agents when connected
  useEffect(() => {
    if (status !== "connected" || !client) return;

    const load = async () => {
      setConfigLoading(true);
      try {
        const [config, agentList] = await Promise.all([
          client.getServerConfig(),
          client.getAgents(),
        ]);
        setServerConfig(config);
        setReposPath(config.reposPath);
        setWorktreesPath(config.worktreesPath);
        setAgents(agentList);
      } catch {
        // Silently fail — connection error will show in status
      } finally {
        setConfigLoading(false);
      }
    };
    load();
  }, [status, client]);

  // Auto-connect on mount if not connected
  useEffect(() => {
    if (status === "offline" || !status) {
      connect(server.id, { serverUrl: server.serverUrl, token: server.token });
    }
  }, []);

  const handleSaveConnection = useCallback(() => {
    updateServer(server.id, { name, serverUrl: url, token });
    // Reconnect with new credentials if they changed
    if (url !== server.serverUrl || token !== server.token) {
      disconnect(server.id);
      connect(server.id, { serverUrl: url, token });
    }
  }, [name, url, token, server, updateServer, disconnect, connect]);

  const handleSaveConfig = useCallback(async () => {
    if (!client) return;
    setConfigSaving(true);
    try {
      await client.updateServerConfig({
        reposPath,
        worktreesPath,
      });
      setServerConfig({ ...serverConfig!, reposPath, worktreesPath });
    } catch {
      // Error handling — could show toast
    } finally {
      setConfigSaving(false);
    }
  }, [client, reposPath, worktreesPath, serverConfig]);

  const handleDelete = useCallback(() => {
    disconnect(server.id);
    removeServer(server.id);
  }, [server.id, disconnect, removeServer]);

  const handleToggleConnection = useCallback(() => {
    if (status === "connected" || status === "connecting" || status === "reconnecting") {
      disconnect(server.id);
    } else {
      connect(server.id, { serverUrl: url, token });
    }
  }, [status, server.id, url, token, connect, disconnect]);

  const isConnected = status === "connected";

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="settings-server-detail">
      {/* Connection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection</CardTitle>
          <CardDescription>Server connection details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            {status === "connected" ? (
              <CheckCircle2 className="size-4 text-green-500" />
            ) : status === "connecting" || status === "reconnecting" ? (
              <Loader2 className="size-4 animate-spin text-yellow-500" />
            ) : (
              <AlertCircle className="size-4 text-muted-foreground" />
            )}
            <span className="text-sm capitalize">{status ?? "offline"}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleConnection}
              className="ml-auto"
              data-testid="server-toggle-connection-btn"
            >
              {isConnected ? <><Unplug className="mr-1 size-3.5" /> Disconnect</> : <><Plug className="mr-1 size-3.5" /> Connect</>}
            </Button>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="server-name-input" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">URL</label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} data-testid="server-url-input" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Token</label>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} data-testid="server-token-input" />
            </div>
            <Button size="sm" onClick={handleSaveConnection} data-testid="server-save-connection-btn">
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Server Configuration Card */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Server Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {configLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <div>
                  <label className="text-xs text-muted-foreground">Repos Path</label>
                  <Input value={reposPath} onChange={(e) => setReposPath(e.target.value)} data-testid="server-repos-path-input" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Worktrees Path</label>
                  <Input value={worktreesPath} onChange={(e) => setWorktreesPath(e.target.value)} data-testid="server-worktrees-path-input" />
                </div>
                <Button size="sm" onClick={handleSaveConfig} disabled={configSaving} data-testid="server-save-config-btn">
                  {configSaving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                  Save
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Agents Card */}
      {isConnected && client && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsAgentsTab agents={agents} onAgentsChange={setAgents} />
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm">Remove this server?</span>
              <Button size="sm" variant="destructive" onClick={handleDelete} data-testid="server-confirm-delete-btn">
                Confirm
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              data-testid="server-delete-btn"
            >
              <Trash2 className="mr-1 size-3.5" />
              Remove Server
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

Note: The `SettingsAgentsTab` component currently uses `useMatrixClient()` internally. It needs to be refactored to accept a `client` prop or use `useServerClient(serverId)`. This will be addressed in Task 12.

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: May have type errors — will fix in subsequent tasks

**Step 3: Commit**

```bash
git add packages/client/src/pages/settings/SettingsServerTab.tsx
git commit -m "feat(client): add SettingsServerTab with connection, config, agents, danger zone"
```

---

### Task 12: Client — Refactor SettingsAgentsTab to Accept Client Prop

**Files:**
- Modify: `packages/client/src/pages/settings/SettingsAgentsTab.tsx`

**Step 1: Change SettingsAgentsTab to accept client as prop**

The current `SettingsAgentsTab` calls `useMatrixClient()` directly. Change it to accept `client` as an optional prop (via `MatrixClient | null`). If provided, use it; otherwise fall back to `useMatrixClient()` for backward compatibility during migration.

At the top of the component, change:
```typescript
// Before
const { client } = useMatrixClient();

// After — accept client from props, with useMatrixClient fallback
```

Add to the props interface:
```typescript
interface SettingsAgentsTabProps {
  agents: AgentListItem[];
  onAgentsChange: (agents: AgentListItem[]) => void;
  client?: MatrixClient | null;
}
```

Then in the component body:
```typescript
const injectedClient = props.client;
const { client: contextClient } = useMatrixClient();
const client = injectedClient ?? contextClient;
```

This way, when called from `SettingsServerTab` with a specific server's client, it uses that. When called from the old single-server settings, it falls back to the context.

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/client/src/pages/settings/SettingsAgentsTab.tsx
git commit -m "refactor(client): make SettingsAgentsTab accept client prop for multi-server"
```

---

### Task 13: Client — Create SettingsNewServerTab Component

**Files:**
- Create: `packages/client/src/pages/settings/SettingsNewServerTab.tsx`

**Step 1: Create new server form**

Create `packages/client/src/pages/settings/SettingsNewServerTab.tsx`:

```typescript
import { useCallback, useState } from "react";
import { useServerStore } from "../../hooks/useServerStore";
import { useMatrixClients } from "../../hooks/useMatrixClients";
import type { SettingsTab } from "./SettingsSidebar";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface SettingsNewServerTabProps {
  onCreated: (tab: SettingsTab) => void;
}

export function SettingsNewServerTab({ onCreated }: SettingsNewServerTabProps) {
  const { addServer } = useServerStore();
  const { connect } = useMatrixClients();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!url || !token) return;

    setTesting(true);
    setTestResult(null);
    setTestError(null);

    // Test connection by fetching auth info
    try {
      const testUrl = url.replace(/\/$/, "");
      const res = await fetch(`${testUrl}/api/auth-info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      setTestResult("success");

      // Save and connect
      const serverName = name || new URL(url).hostname;
      const server = addServer(serverName, url, token);
      await connect(server.id, { serverUrl: url, token });
      onCreated({ kind: "server", serverId: server.id });
    } catch (err) {
      setTestResult("error");
      setTestError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }, [name, url, token, addServer, connect, onCreated]);

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="settings-new-server">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Server</CardTitle>
          <CardDescription>Connect to a Matrix server</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Name (optional)</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Server"
              data-testid="new-server-name-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Server URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.1.100:19880"
              data-testid="new-server-url-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Token</label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Server auth token"
              data-testid="new-server-token-input"
            />
          </div>

          {testResult === "success" && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="size-4" />
              Connected successfully
            </div>
          )}
          {testResult === "error" && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {testError}
            </div>
          )}

          <Button
            onClick={handleSave}
            disabled={!url || !token || testing}
            data-testid="new-server-save-btn"
          >
            {testing ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {testing ? "Testing connection..." : "Save & Connect"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/client/src/pages/settings/SettingsNewServerTab.tsx
git commit -m "feat(client): add SettingsNewServerTab with connection testing"
```

---

### Task 14: Client — Update SettingsPage to Wire Everything Together

**Files:**
- Modify: `packages/client/src/pages/SettingsPage.tsx`

**Step 1: Update SettingsPage**

Rewrite `SettingsPage` to use the new sidebar, server tabs, and multi-client hooks. The General tab now only shows About/update info. Server config and agents move to per-server tabs.

Key changes:
1. Import new components: `SettingsServerTab`, `SettingsNewServerTab`, updated `SettingsSidebar`
2. Import `useServerStore` for server list and `useMatrixClients` for statuses
3. Remove agents loading from SettingsPage (moved to SettingsServerTab)
4. Remove server config loading from SettingsPage (moved to SettingsServerTab)
5. Add routing for `{ kind: "server" }` and `{ kind: "new-server" }` tabs
6. Pass `servers` and `serverStatuses` to SettingsSidebar
7. Simplify SettingsGeneralTab — remove Remote Servers and Server Configuration cards

The full file should be rewritten. Key structure:

```typescript
export function SettingsPage({ onBack, repositories, onDeleteRepository }: SettingsPageProps) {
  const [selectedTab, setSelectedTab] = useState<SettingsTab>({ kind: "general" });
  const { servers } = useServerStore();
  const { statuses } = useMatrixClients();

  const selectedRepo = selectedTab.kind === "repository"
    ? repositories.find((r) => r.id === selectedTab.repositoryId)
    : null;

  const selectedServer = selectedTab.kind === "server"
    ? servers.find((s) => s.id === selectedTab.serverId)
    : null;

  // If the selected server was deleted, fall back to general
  useEffect(() => {
    if (selectedTab.kind === "server" && !selectedServer) {
      setSelectedTab({ kind: "general" });
    }
  }, [selectedTab, selectedServer]);

  return (
    <div className="flex h-full flex-1 bg-background" data-testid="settings-overlay">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header with back/close buttons — keep existing */}
        <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
          {/* ... existing header ... */}
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <SettingsSidebar
            repositories={repositories}
            servers={servers}
            serverStatuses={statuses}
            selectedTab={selectedTab}
            onSelectTab={setSelectedTab}
          />

          <div className="min-h-0 flex-1 overflow-y-auto bg-background">
            {selectedTab.kind === "general" && (
              <SettingsGeneralTab />
            )}
            {selectedTab.kind === "server" && selectedServer && (
              <SettingsServerTab server={selectedServer} />
            )}
            {selectedTab.kind === "new-server" && (
              <SettingsNewServerTab onCreated={setSelectedTab} />
            )}
            {selectedTab.kind === "repository" && selectedRepo && (
              <SettingsRepositoryTab
                repository={selectedRepo}
                onDeleteRepository={onDeleteRepository}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Simplify SettingsGeneralTab**

In `packages/client/src/pages/settings/SettingsGeneralTab.tsx`, remove the following cards:
- "Current Connection" card (moved to per-server tab)
- "Server Configuration" card (moved to per-server tab)
- "Remote Servers" card (now in sidebar + per-server tab)

Keep only:
- "About" card (version, update channel, check for updates)

Remove props that are no longer needed (connectionInfo, serverConfig, onSaveConfig, servers, onConnect, etc.). The simplified tab only needs auto-update props.

**Step 3: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS (may need iterative fixes)

**Step 4: Commit**

```bash
git add packages/client/src/pages/SettingsPage.tsx packages/client/src/pages/settings/SettingsGeneralTab.tsx
git commit -m "feat(client): wire up settings page with server tabs and simplified general tab"
```

---

### Task 15: Client — Update AppLayout Sidebar for Multi-Server

**Files:**
- Modify: `packages/client/src/components/layout/AppLayout.tsx`

**Step 1: Add server-grouped sidebar**

This is the biggest UI change. The sidebar currently shows a flat list of repos. Change it to show repos grouped under their server, with session selection carrying `serverId`.

Key changes:
1. Import `useMatrixClients`, `useServerStore`, `useServerData`
2. Change `selectedSessionId: string | null` to `selectedSession: { serverId: string; sessionId: string } | null`
3. Create a `ServerSection` component that renders one server's repos/worktrees/sessions
4. Handle session deletion checking against `selectedSession`
5. Pass `serverId` to `SessionView`

The sidebar content should render:
```typescript
function SidebarContent() {
  const { servers } = useServerStore();
  return (
    <div>
      {servers.map(server => (
        <ServerSection key={server.id} serverId={server.id} />
      ))}
    </div>
  );
}
```

Each `ServerSection` uses `useServerData(serverId)` internally.

For `SessionView`, pass the selected session's `serverId`:
```typescript
<SessionView
  serverId={selectedSession.serverId}
  sessionInfo={currentSessionInfo}
  // ... other props
/>
```

**Important:** The existing `AppLayout` is 548 lines with complex state management. Rather than rewriting the entire file, focus on:
1. Adding the `selectedSession` composite key
2. Wrapping the sidebar repos list with server grouping
3. Passing `serverId` through to `SessionView`
4. Keeping all existing dialog/worktree/clone logic working

The detailed implementation should preserve all existing functionality while adding server grouping.

**Step 2: Run type check and dev server**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/client/src/components/layout/AppLayout.tsx
git commit -m "feat(client): restructure sidebar with server-grouped repos and sessions"
```

---

### Task 16: Client — Update SessionView for Multi-Server

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx`

**Step 1: Add serverId prop and use useServerClient**

Change `SessionView` to accept `serverId` prop and use it to get the correct client:

```typescript
interface SessionViewProps {
  serverId: string;
  sessionInfo: SessionInfo;
  // ... other existing props
}

export function SessionView({ serverId, sessionInfo, ...props }: SessionViewProps) {
  const { client } = useServerClient(serverId);
  // Rest of the component stays the same — just replacing useMatrixClient() with useServerClient(serverId)
}
```

Replace the `useMatrixClient()` call at line 37 with:
```typescript
const { client } = useServerClient(serverId);
```

This is a minimal change — the rest of the session logic (attach, prompt, subscribe) works the same way since it operates on the `MatrixClient` instance.

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx
git commit -m "feat(client): update SessionView to use serverId for multi-server support"
```

---

### Task 17: Client — Update App.tsx Provider Tree

**Files:**
- Modify: `packages/client/src/App.tsx`

**Step 1: Add MatrixClientsProvider to provider tree**

Wrap the app with `MatrixClientsProvider`. Keep the existing `MatrixClientProvider` for backward compatibility during migration (it handles the local sidecar auto-connect). Add `useConnectionRecovery()` call.

```typescript
import { MatrixClientsProvider } from "./hooks/useMatrixClients";

function App() {
  return (
    <MatrixClientsProvider>
      <MatrixClientProvider>
        <ServerStoreProvider>
          <UpdateProvider>
            <AppContent />
          </UpdateProvider>
        </ServerStoreProvider>
      </MatrixClientProvider>
    </MatrixClientsProvider>
  );
}
```

Add `useConnectionRecovery()` in `AppContent`:

```typescript
import { useConnectionRecovery } from "./hooks/useConnectionRecovery";

function AppContent() {
  useConnectionRecovery();
  // ... existing logic
}
```

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/client/src/App.tsx
git commit -m "feat(client): add MatrixClientsProvider and connection recovery to App"
```

---

### Task 18: Client — Handle Selected Session Deletion (Dirty Data)

**Files:**
- Modify: `packages/client/src/components/layout/AppLayout.tsx`

**Step 1: Add effect to handle deleted sessions**

In `AppLayout`, add an effect that watches for the currently selected session being removed from server data:

```typescript
// Watch for selected session being deleted remotely
useEffect(() => {
  if (!selectedSession) return;

  const serverData = /* get server data for selectedSession.serverId */;
  if (!serverData) return;

  const sessionStillExists = serverData.sessions.some(
    s => s.sessionId === selectedSession.sessionId
  );

  if (!sessionStillExists) {
    // Fall back to the most recent session on the same server, or clear
    const fallback = serverData.sessions[0];
    if (fallback) {
      setSelectedSession({ serverId: selectedSession.serverId, sessionId: fallback.sessionId });
    } else {
      setSelectedSession(null);
    }
  }
}, [selectedSession, /* server data dependency */]);
```

**Step 2: Run type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/client/src/components/layout/AppLayout.tsx
git commit -m "feat(client): handle remote session deletion with fallback navigation"
```

---

### Task 19: Full Integration — Type Check and Build

**Step 1: Run full type check across all packages**

Run: `npx tsc --build` (or the project's build command)
Expected: PASS

**Step 2: Run dev server to verify**

Run: `npm run dev` (or equivalent)
Expected: App starts without errors

**Step 3: Fix any remaining type/import errors**

Iterate until clean.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type errors from multi-server integration"
```

---

### Task 20: E2E Tests — Update Existing Tests for New Sidebar Structure

**Files:**
- Modify: `tests/e2e/mac/lib/flows/setup.ts`
- Modify: `tests/e2e/mac/flows/settings-repo-info.test.ts`
- Modify: `tests/e2e/mac/flows/connect-server.test.ts`

**Step 1: Update e2e test utilities**

The sidebar structure changed — repos are now under server sections. Update selectors if needed:
- `data-testid="add-repo-btn"` may need to be scoped under a server section
- `data-testid="repo-item-*"` may need server context
- Settings tests need to account for the new sidebar layout

Review each test file and update selectors to match the new DOM structure. The key principle: tests should still pass with the new layout, just with updated selectors if the DOM structure changed.

**Step 2: Run e2e tests**

Run: `npm run test:e2e:mac` (or equivalent)
Expected: All 11 test cases PASS

**Step 3: Commit**

```bash
git add tests/
git commit -m "fix(e2e): update test selectors for multi-server sidebar layout"
```

---

### Task 21: Final Verification

**Step 1: Run full test suite**

Run: `npm run test:e2e:mac`
Expected: All tests PASS

**Step 2: Run type check**

Run: `npx tsc --build`
Expected: PASS

**Step 3: Visual check**

Verify in dev mode:
- Settings page opens full-screen (no repo sidebar)
- Settings sidebar shows General, Servers section, Repositories section
- Clicking a server shows its config page
- "Add Server..." opens new server form
- Main sidebar shows repos grouped under servers

**Step 4: Final commit if any remaining fixes**

```bash
git add -A
git commit -m "fix: final adjustments for multi-server architecture"
```
