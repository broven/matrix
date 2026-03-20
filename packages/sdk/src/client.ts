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
  FsListResponse,
  CloneRepositoryRequest,
  CloneRepositoryResponse,
  CloneJobInfo,
  ServerConfig,
  CustomAgent,
  AgentEnvProfile,
  AgentTestResult,
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
  private errorListeners: Array<(error: Error) => void> = [];

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
        for (const listener of this.errorListeners) {
          listener(err);
        }
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

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.push(listener);
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
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

  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    const res = await this.fetch("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create session" }));
      throw new Error((err as any).error || `Failed to create session: ${res.status}`);
    }
    return res.json();
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

  async deleteRepository(id: string, deleteSource = false): Promise<void> {
    const url = deleteSource ? `/repositories/${id}?deleteSource=true` : `/repositories/${id}`;
    const res = await this.fetch(url, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Failed to delete repository ${id}: ${res.status}`);
    }
  }

  // ── Filesystem ──────────────────────────────────────────────────

  async listDirectory(path?: string): Promise<FsListResponse> {
    const params = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await this.fetch(`/fs/list${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to list directory" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  // ── Clone ─────────────────────────────────────────────────────

  async cloneRepository(request: CloneRepositoryRequest): Promise<CloneRepositoryResponse> {
    const res = await this.fetch("/repositories/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to start clone" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  async getCloneJob(jobId: string): Promise<CloneJobInfo> {
    const res = await this.fetch(`/repositories/clone/${jobId}`);
    if (!res.ok) {
      throw new Error(`Failed to get clone job ${jobId}: ${res.status}`);
    }
    return res.json();
  }

  async getCloneJobs(): Promise<CloneJobInfo[]> {
    const res = await this.fetch("/repositories/clone-jobs");
    if (!res.ok) {
      throw new Error(`Failed to get clone jobs: ${res.status}`);
    }
    return res.json();
  }

  // ── Server Config ─────────────────────────────────────────────

  async getServerConfig(): Promise<ServerConfig> {
    const res = await this.fetch("/server/config");
    if (!res.ok) {
      throw new Error(`Failed to get server config: ${res.status}`);
    }
    return res.json();
  }

  async updateServerConfig(config: Partial<ServerConfig>): Promise<ServerConfig> {
    const res = await this.fetch("/server/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      throw new Error(`Failed to update server config: ${res.status}`);
    }
    return res.json();
  }

  // ── Worktrees ────────────────────────────────────────────────────

  async getWorktrees(repositoryId: string): Promise<WorktreeInfo[]> {
    const res = await this.fetch(`/repositories/${repositoryId}/worktrees`);
    if (!res.ok) {
      throw new Error(`Failed to get worktrees for ${repositoryId}: ${res.status}`);
    }
    return res.json();
  }

  async createWorktree(repositoryId: string, request: { branch: string; baseBranch: string }): Promise<CreateWorktreeResponse> {
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

  // ── Custom Agents ──────────────────────────────────────────────

  async getCustomAgents(): Promise<CustomAgent[]> {
    const res = await this.fetch("/custom-agents");
    if (!res.ok) throw new Error(`Failed to get custom agents: ${res.status}`);
    return res.json();
  }

  async createCustomAgent(agent: Omit<CustomAgent, "id"> & { id?: string }): Promise<CustomAgent> {
    const res = await this.fetch("/custom-agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agent),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create custom agent" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  async updateCustomAgent(id: string, patch: Partial<Omit<CustomAgent, "id">>): Promise<CustomAgent> {
    const res = await this.fetch(`/custom-agents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to update custom agent" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  async deleteCustomAgent(id: string): Promise<void> {
    const res = await this.fetch(`/custom-agents/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to delete custom agent ${id}: ${res.status}`);
  }

  async testCustomAgent(config: { command: string; args: string[]; env?: Record<string, string> }): Promise<AgentTestResult> {
    const res = await this.fetch("/custom-agents/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to test agent" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  // ── Agent Env Profiles ────────────────────────────────────────

  async getAgentProfiles(parentAgentId?: string): Promise<AgentEnvProfile[]> {
    const params = parentAgentId ? `?parentAgentId=${encodeURIComponent(parentAgentId)}` : "";
    const res = await this.fetch(`/agent-profiles${params}`);
    if (!res.ok) throw new Error(`Failed to get agent profiles: ${res.status}`);
    return res.json();
  }

  async createAgentProfile(profile: { parentAgentId: string; name: string; env?: Record<string, string> }): Promise<AgentEnvProfile> {
    const res = await this.fetch("/agent-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create profile" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  async updateAgentProfile(id: string, patch: { name?: string; env?: Record<string, string> }): Promise<AgentEnvProfile> {
    const res = await this.fetch(`/agent-profiles/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to update profile" }));
      throw new Error((err as any).error || `Failed: ${res.status}`);
    }
    return res.json();
  }

  async deleteAgentProfile(id: string): Promise<void> {
    const res = await this.fetch(`/agent-profiles/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to delete profile ${id}: ${res.status}`);
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
