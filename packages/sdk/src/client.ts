import type {
  TransportMode,
  ConnectionStatus,
  ServerMessage,
  AgentListItem,
  CreateSessionRequest,
  CreateSessionResponse,
  SessionInfo,
  RepositoryInfo,
  WorktreeInfo,
  AddRepositoryRequest,
  CreateWorktreeRequest,
  CreateWorktreeResponse,
} from "@matrix/protocol";
import { createTransport, type Transport } from "./transport/index.js";
import { MatrixSession } from "./session.js";

export interface MatrixClientConfig {
  serverUrl: string;
  token: string;
  transport?: TransportMode;
}

export class MatrixClient {
  readonly serverUrl: string;
  readonly transportMode: TransportMode;
  private token: string;
  private transport: Transport | null = null;
  private sessions = new Map<string, MatrixSession>();
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];

  constructor(config: MatrixClientConfig) {
    this.serverUrl = config.serverUrl;
    this.token = config.token;
    this.transportMode = config.transport ?? "auto";
  }

  connect(): void {
    this.transport = createTransport({
      serverUrl: this.serverUrl,
      token: this.token,
      mode: this.transportMode,
    });

    this.transport.connect({
      onMessage: (msg) => this.handleServerMessage(msg),
      onStatusChange: (status) => {
        if (status === "connected") {
          const lastEventId = this.transport?.getLastEventId();
          for (const session of this.sessions.values()) {
            session.subscribe(lastEventId);
          }
        }
        for (const listener of this.statusListeners) {
          listener(status);
        }
      },
      onError: (err) => {
        console.error("[MatrixClient] Transport error:", err);
      },
    });
  }

  disconnect(): void {
    this.transport?.disconnect();
    this.transport = null;
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  async getAgents(): Promise<AgentListItem[]> {
    const res = await this.fetch("/agents");
    if (!res.ok) {
      throw new Error(`Failed to get agents: ${res.status}`);
    }
    return res.json();
  }

  async getSessions(): Promise<SessionInfo[]> {
    const res = await this.fetch("/sessions");
    if (!res.ok) {
      throw new Error(`Failed to get sessions: ${res.status}`);
    }
    return res.json();
  }

  async createSession(request: CreateSessionRequest): Promise<MatrixSession> {
    const res = await this.fetch("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create session" }));
      throw new Error((err as any).error || `Failed to create session: ${res.status}`);
    }
    const data: CreateSessionResponse = await res.json();

    const session = new MatrixSession(
      data.sessionId,
      this.transport!,
      (path, init) => this.fetch(path, init),
    );
    this.sessions.set(data.sessionId, session);

    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const res = await this.fetch(`/sessions/${sessionId}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Failed to delete session ${sessionId}: ${res.status}`);
    }
    this.sessions.delete(sessionId);
  }

  // ── Repositories ──────────────────────────────────────────────────

  async getRepositories(): Promise<RepositoryInfo[]> {
    const res = await this.fetch("/repositories");
    if (!res.ok) {
      throw new Error(`Failed to get repositories: ${res.status}`);
    }
    return res.json();
  }

  async addRepository(request: AddRepositoryRequest): Promise<RepositoryInfo> {
    const res = await this.fetch("/repositories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to add repository" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  async deleteRepository(id: string): Promise<void> {
    const res = await this.fetch(`/repositories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Failed to delete repository ${id}: ${res.status}`);
    }
  }

  // ── Worktrees ────────────────────────────────────────────────────

  async getWorktrees(repositoryId: string): Promise<WorktreeInfo[]> {
    const res = await this.fetch(`/repositories/${repositoryId}/worktrees`);
    if (!res.ok) {
      throw new Error(`Failed to get worktrees for ${repositoryId}: ${res.status}`);
    }
    return res.json();
  }

  async createWorktree(repositoryId: string, request: CreateWorktreeRequest): Promise<CreateWorktreeResponse> {
    const res = await this.fetch(`/repositories/${repositoryId}/worktrees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create worktree" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  async deleteWorktree(id: string): Promise<void> {
    const res = await this.fetch(`/worktrees/${id}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Failed to delete worktree ${id}: ${res.status}`);
    }
  }

  // ── Session helpers ──────────────────────────────────────────────

  attachSession(sessionId: string): MatrixSession {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    if (!this.transport) {
      throw new Error("MatrixClient must be connected before attaching a session");
    }

    const session = new MatrixSession(
      sessionId,
      this.transport,
      (path, init) => this.fetch(path, init),
    );
    this.sessions.set(sessionId, session);
    return session;
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(`${this.serverUrl}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${this.token}`,
      },
    });
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "session:update": {
        const session = this.sessions.get(msg.sessionId);
        session?.handleUpdate(msg.update);
        break;
      }
      case "session:snapshot": {
        const session = this.sessions.get(msg.sessionId);
        session?.handleSnapshot(msg.history);
        break;
      }
      case "session:suspended": {
        const session = this.sessions.get(msg.sessionId);
        session?.handleSuspended();
        break;
      }
      case "session:restoring": {
        const session = this.sessions.get(msg.sessionId);
        session?.handleRestoring();
        break;
      }
      case "session:closed": {
        this.sessions.delete(msg.sessionId);
        break;
      }
      case "error": {
        if (msg.sessionId) {
          const session = this.sessions.get(msg.sessionId);
          session?.handleError({ code: msg.code, message: msg.message });
        }
        console.error("[MatrixClient] Server error:", msg.message);
        break;
      }
    }
  }
}
