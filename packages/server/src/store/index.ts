import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  SessionInfo,
  HistoryEntry,
  HistoryEntryType,
  RepositoryInfo,
  WorktreeInfo,
  WorktreeStatus,
  CustomAgent,
  AgentEnvProfile,
} from "@matrix/protocol";
import { nanoid } from "nanoid";

interface CreateSessionOptions {
  recoverable?: boolean;
  agentSessionId?: string | null;
  lastActiveAt?: string;
  worktreeId?: string | null;
}

interface SessionStatePatch {
  status?: SessionInfo["status"];
  agentId?: string | null;
  profileId?: string | null;
  recoverable?: boolean;
  agentSessionId?: string | null;
  lastActiveAt?: string;
  suspendedAt?: string | null;
  closeReason?: string | null;
}

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    const { user_version: currentVersion } = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };

    const migrations: Array<(db: Database) => void> = [
      // v1: bootstrap full schema or fix legacy databases
      (db) => {
        const hasSessionsTable =
          (
            db
              .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
              .all() as Array<{ name: string }>
          ).length > 0;

        if (!hasSessionsTable) {
          // Fresh install — create all tables with current schema
          db.exec(`
            CREATE TABLE sessions (
              session_id TEXT PRIMARY KEY,
              agent_id TEXT,
              cwd TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'active',
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              recoverable INTEGER NOT NULL DEFAULT 0,
              agent_session_id TEXT,
              last_active_at TEXT,
              suspended_at TEXT,
              close_reason TEXT,
              worktree_id TEXT,
              profile_id TEXT
            );

            CREATE TABLE history (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              type TEXT NOT NULL DEFAULT 'text',
              metadata TEXT,
              timestamp TEXT NOT NULL DEFAULT (datetime('now')),
              FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            );

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

            CREATE TABLE custom_agents (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              command TEXT NOT NULL,
              args TEXT NOT NULL DEFAULT '[]',
              env TEXT,
              icon TEXT,
              description TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE agent_env_profiles (
              id TEXT PRIMARY KEY,
              parent_agent_id TEXT NOT NULL,
              name TEXT NOT NULL,
              env TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
          `);
        } else {
          // Legacy upgrade — ensure all columns and tables exist, then rebuild sessions
          this.ensureLegacyColumns(db);
          this.ensureLegacyTables(db);
          this.rebuildSessionsTable(db);
        }
      },
    ];

    for (let i = currentVersion; i < migrations.length; i++) {
      this.db.transaction(() => {
        migrations[i](this.db);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
      })();
    }
  }

  /** Add missing columns to legacy sessions/history tables */
  private ensureLegacyColumns(db: Database): void {
    const sessionColumns = (
      db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
    ).map((c) => c.name);

    if (!sessionColumns.includes("recoverable")) {
      db.exec("ALTER TABLE sessions ADD COLUMN recoverable INTEGER NOT NULL DEFAULT 0");
    }
    if (!sessionColumns.includes("agent_session_id")) {
      db.exec("ALTER TABLE sessions ADD COLUMN agent_session_id TEXT");
    }
    if (!sessionColumns.includes("last_active_at")) {
      db.exec("ALTER TABLE sessions ADD COLUMN last_active_at TEXT");
      db.exec("UPDATE sessions SET last_active_at = created_at WHERE last_active_at IS NULL");
    }
    if (!sessionColumns.includes("suspended_at")) {
      db.exec("ALTER TABLE sessions ADD COLUMN suspended_at TEXT");
    }
    if (!sessionColumns.includes("close_reason")) {
      db.exec("ALTER TABLE sessions ADD COLUMN close_reason TEXT");
    }
    if (!sessionColumns.includes("worktree_id")) {
      db.exec("ALTER TABLE sessions ADD COLUMN worktree_id TEXT");
    }
    if (!sessionColumns.includes("profile_id")) {
      db.exec("ALTER TABLE sessions ADD COLUMN profile_id TEXT");
    }

    const historyColumns = (
      db.prepare("PRAGMA table_info(history)").all() as Array<{ name: string }>
    ).map((c) => c.name);

    if (!historyColumns.includes("type")) {
      db.exec("ALTER TABLE history ADD COLUMN type TEXT NOT NULL DEFAULT 'text'");
    }
    if (!historyColumns.includes("metadata")) {
      db.exec("ALTER TABLE history ADD COLUMN metadata TEXT");
    }
  }

  /** Create tables that didn't exist in early versions */
  private ensureLegacyTables(db: Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        remote_url TEXT,
        server_id TEXT NOT NULL DEFAULT 'local',
        default_branch TEXT NOT NULL DEFAULT 'main',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS worktrees (
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

      CREATE TABLE IF NOT EXISTS custom_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        env TEXT,
        icon TEXT,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agent_env_profiles (
        id TEXT PRIMARY KEY,
        parent_agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        env TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** Rebuild sessions table to make agent_id nullable */
  private rebuildSessionsTable(db: Database): void {
    db.exec(`
      CREATE TABLE sessions_new (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        recoverable INTEGER NOT NULL DEFAULT 0,
        agent_session_id TEXT,
        last_active_at TEXT,
        suspended_at TEXT,
        close_reason TEXT,
        worktree_id TEXT,
        profile_id TEXT
      );

      INSERT INTO sessions_new SELECT
        session_id, agent_id, cwd, status, created_at,
        recoverable, agent_session_id, last_active_at,
        suspended_at, close_reason, worktree_id, profile_id
      FROM sessions;

      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
    `);
  }

  // ── Repositories ──────────────────────────────────────────────────

  createRepository(
    name: string,
    path: string,
    options: { remoteUrl?: string; serverId?: string; defaultBranch?: string } = {},
  ): RepositoryInfo {
    const id = `repo_${nanoid()}`;
    const now = this.getCurrentTimestamp();
    this.db.prepare(
      `INSERT INTO repositories (id, name, path, remote_url, server_id, default_branch, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      path,
      options.remoteUrl ?? null,
      options.serverId ?? "local",
      options.defaultBranch ?? "main",
      now,
    );
    return this.getRepository(id)!;
  }

  listRepositories(): RepositoryInfo[] {
    return this.db
      .prepare("SELECT * FROM repositories ORDER BY created_at DESC")
      .all()
      .map((row: any) => this.mapRepository(row));
  }

  getRepository(id: string): RepositoryInfo | null {
    const row = this.db
      .prepare("SELECT * FROM repositories WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRepository(row) : null;
  }

  getRepositoryByPath(repoPath: string): RepositoryInfo | null {
    const row = this.db
      .prepare("SELECT * FROM repositories WHERE path = ?")
      .get(repoPath) as Record<string, unknown> | undefined;
    return row ? this.mapRepository(row) : null;
  }

  deleteRepository(id: string): void {
    this.db.transaction(() => {
      // Delete all sessions in worktrees of this repo
      this.db.prepare(
        `DELETE FROM history WHERE session_id IN (
          SELECT session_id FROM sessions WHERE worktree_id IN (
            SELECT id FROM worktrees WHERE repository_id = ?
          )
        )`
      ).run(id);
      this.db.prepare(
        `DELETE FROM sessions WHERE worktree_id IN (
          SELECT id FROM worktrees WHERE repository_id = ?
        )`
      ).run(id);
      this.db.prepare("DELETE FROM worktrees WHERE repository_id = ?").run(id);
      this.db.prepare("DELETE FROM repositories WHERE id = ?").run(id);
    })();
  }

  private mapRepository(row: Record<string, unknown>): RepositoryInfo {
    return {
      id: String(row.id),
      name: String(row.name),
      path: String(row.path),
      remoteUrl: row.remote_url == null ? null : String(row.remote_url),
      serverId: String(row.server_id),
      defaultBranch: String(row.default_branch),
      createdAt: String(row.created_at),
    };
  }

  // ── Worktrees ─────────────────────────────────────────────────────

  createWorktree(
    repositoryId: string,
    branch: string,
    baseBranch: string,
    worktreePath: string,
    taskDescription?: string,
  ): WorktreeInfo {
    const id = `wt_${nanoid()}`;
    const now = this.getCurrentTimestamp();
    this.db.prepare(
      `INSERT INTO worktrees (id, repository_id, branch, base_branch, path, task_description, status, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(id, repositoryId, branch, baseBranch, worktreePath, taskDescription ?? null, now, now);
    return this.getWorktree(id)!;
  }

  listWorktrees(repositoryId: string): WorktreeInfo[] {
    return this.db
      .prepare("SELECT * FROM worktrees WHERE repository_id = ? ORDER BY created_at DESC")
      .all(repositoryId)
      .map((row: any) => this.mapWorktree(row));
  }

  getWorktree(id: string): WorktreeInfo | null {
    const row = this.db
      .prepare("SELECT * FROM worktrees WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapWorktree(row) : null;
  }

  updateWorktreeStatus(id: string, status: WorktreeStatus): void {
    this.db.prepare("UPDATE worktrees SET status = ? WHERE id = ?").run(status, id);
  }

  touchWorktree(id: string, timestamp = this.getCurrentTimestamp()): void {
    this.db.prepare("UPDATE worktrees SET last_active_at = ? WHERE id = ?").run(timestamp, id);
  }

  deleteWorktree(id: string): void {
    this.db.transaction(() => {
      this.db.prepare(
        `DELETE FROM history WHERE session_id IN (
          SELECT session_id FROM sessions WHERE worktree_id = ?
        )`
      ).run(id);
      this.db.prepare("DELETE FROM sessions WHERE worktree_id = ?").run(id);
      this.db.prepare("DELETE FROM worktrees WHERE id = ?").run(id);
    })();
  }

  getSessionsByWorktree(worktreeId: string): SessionInfo[] {
    return this.db
      .prepare(
        `SELECT s.session_id, s.agent_id, s.cwd, s.status, s.created_at, s.recoverable,
                s.agent_session_id, s.last_active_at, s.suspended_at, s.close_reason, s.worktree_id, s.profile_id,
                w.repository_id AS wt_repository_id, w.branch AS wt_branch
         FROM sessions s
         LEFT JOIN worktrees w ON s.worktree_id = w.id
         WHERE s.worktree_id = ? ORDER BY s.created_at DESC`
      )
      .all(worktreeId)
      .map((row: any) => this.mapSessionRow(row));
  }

  private mapWorktree(row: Record<string, unknown>): WorktreeInfo {
    return {
      id: String(row.id),
      repositoryId: String(row.repository_id),
      branch: String(row.branch),
      baseBranch: String(row.base_branch),
      path: String(row.path),
      status: row.status as WorktreeStatus,
      taskDescription: row.task_description == null ? null : String(row.task_description),
      createdAt: String(row.created_at),
      lastActiveAt: String(row.last_active_at),
    };
  }

  // ── Sessions ──────────────────────────────────────────────────────

  createSession(
    sessionId: string,
    agentId: string | null,
    cwd: string,
    options: CreateSessionOptions = {},
  ): SessionInfo {
    const now = options.lastActiveAt ?? this.getCurrentTimestamp();
    const stmt = this.db.prepare(
      `INSERT INTO sessions (
        session_id,
        agent_id,
        cwd,
        status,
        created_at,
        recoverable,
        agent_session_id,
        last_active_at,
        suspended_at,
        close_reason,
        worktree_id
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NULL, NULL, ?)`
    );
    stmt.run(
      sessionId,
      agentId,
      cwd,
      now,
      options.recoverable ? 1 : 0,
      options.agentSessionId ?? null,
      now,
      options.worktreeId ?? null,
    );

    return this.getSession(sessionId)!;
  }

  listSessions(): SessionInfo[] {
    const stmt = this.db.prepare(
      `SELECT
        s.session_id,
        s.agent_id,
        s.profile_id,
        s.cwd,
        s.status,
        s.created_at,
        s.recoverable,
        s.agent_session_id,
        s.last_active_at,
        s.suspended_at,
        s.close_reason,
        s.worktree_id,
        w.repository_id AS wt_repository_id,
        w.branch AS wt_branch
      FROM sessions s
      LEFT JOIN worktrees w ON s.worktree_id = w.id
      ORDER BY s.created_at DESC`
    );
    return stmt.all().map((row: any) => this.mapSessionRow(row));
  }

  closeSession(sessionId: string): void {
    this.updateSessionState(sessionId, {
      status: "closed",
      suspendedAt: null,
      closeReason: "user_closed",
    });
  }

  reopenSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (session.status === "active") return;

    this.updateSessionState(sessionId, {
      status: "active",
      suspendedAt: null,
      closeReason: null,
    });
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM history WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
  }

  getSession(sessionId: string): SessionInfo | null {
    const stmt = this.db.prepare(
      `SELECT
        s.session_id,
        s.agent_id,
        s.profile_id,
        s.cwd,
        s.status,
        s.created_at,
        s.recoverable,
        s.agent_session_id,
        s.last_active_at,
        s.suspended_at,
        s.close_reason,
        s.worktree_id,
        w.repository_id AS wt_repository_id,
        w.branch AS wt_branch
      FROM sessions s
      LEFT JOIN worktrees w ON s.worktree_id = w.id
      WHERE s.session_id = ?`
    );
    const row = stmt.get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapSessionRow(row) : null;
  }

  updateSessionState(sessionId: string, patch: SessionStatePatch): void {
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];

    if (patch.status !== undefined) {
      assignments.push("status = ?");
      values.push(patch.status);
    }
    if (patch.agentId !== undefined) {
      assignments.push("agent_id = ?");
      values.push(patch.agentId);
    }
    if (patch.profileId !== undefined) {
      assignments.push("profile_id = ?");
      values.push(patch.profileId);
    }
    if (patch.recoverable !== undefined) {
      assignments.push("recoverable = ?");
      values.push(patch.recoverable ? 1 : 0);
    }
    if (patch.agentSessionId !== undefined) {
      assignments.push("agent_session_id = ?");
      values.push(patch.agentSessionId);
    }
    if (patch.lastActiveAt !== undefined) {
      assignments.push("last_active_at = ?");
      values.push(patch.lastActiveAt);
    }
    if (patch.suspendedAt !== undefined) {
      assignments.push("suspended_at = ?");
      values.push(patch.suspendedAt);
    }
    if (patch.closeReason !== undefined) {
      assignments.push("close_reason = ?");
      values.push(patch.closeReason);
    }

    if (assignments.length === 0) {
      return;
    }

    values.push(sessionId);
    this.db
      .prepare(`UPDATE sessions SET ${assignments.join(", ")} WHERE session_id = ?`)
      .run(...values);
  }

  touchSession(sessionId: string, timestamp = this.getCurrentTimestamp()): void {
    this.updateSessionState(sessionId, { lastActiveAt: timestamp });
  }

  normalizeSessionsOnStartup(): void {
    const now = this.getCurrentTimestamp();
    // Recoverable sessions stay active — agent will be lazily restored on next prompt
    this.db.prepare(
      `UPDATE sessions
      SET suspended_at = COALESCE(suspended_at, ?)
      WHERE status = 'active' AND recoverable = 1`
    ).run(now);

    // Non-recoverable active sessions must be closed
    this.db.prepare(
      `UPDATE sessions
      SET status = 'closed',
          suspended_at = NULL,
          close_reason = 'server_restart_unrecoverable'
      WHERE status = 'active' AND recoverable = 0 AND agent_id IS NOT NULL`
    ).run();

    // Close stale lazy sessions (never had an agent assigned)
    this.db.prepare(
      `UPDATE sessions
      SET status = 'closed',
          close_reason = 'server_restart_unused'
      WHERE status = 'active' AND agent_id IS NULL`
    ).run();
  }

  // ── Custom Agents ────────────────────────────────────────────────

  createCustomAgent(agent: Omit<CustomAgent, "id"> & { id?: string }): CustomAgent {
    const id = agent.id || `agent_${nanoid()}`;
    const now = this.getCurrentTimestamp();
    this.db.prepare(
      `INSERT INTO custom_agents (id, name, command, args, env, icon, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      agent.name,
      agent.command,
      JSON.stringify(agent.args),
      agent.env ? JSON.stringify(agent.env) : null,
      agent.icon ?? null,
      agent.description ?? null,
      now,
    );
    return this.getCustomAgent(id)!;
  }

  getCustomAgent(id: string): CustomAgent | null {
    const row = this.db
      .prepare("SELECT * FROM custom_agents WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapCustomAgent(row) : null;
  }

  listCustomAgents(): CustomAgent[] {
    return this.db
      .prepare("SELECT * FROM custom_agents ORDER BY created_at ASC")
      .all()
      .map((row: any) => this.mapCustomAgent(row));
  }

  updateCustomAgent(id: string, patch: Partial<Omit<CustomAgent, "id">>): CustomAgent | null {
    const assignments: string[] = [];
    const values: Array<string | null> = [];

    if (patch.name !== undefined) { assignments.push("name = ?"); values.push(patch.name); }
    if (patch.command !== undefined) { assignments.push("command = ?"); values.push(patch.command); }
    if (patch.args !== undefined) { assignments.push("args = ?"); values.push(JSON.stringify(patch.args)); }
    if (patch.env !== undefined) { assignments.push("env = ?"); values.push(JSON.stringify(patch.env)); }
    if (patch.icon !== undefined) { assignments.push("icon = ?"); values.push(patch.icon ?? null); }
    if (patch.description !== undefined) { assignments.push("description = ?"); values.push(patch.description ?? null); }

    if (assignments.length === 0) return this.getCustomAgent(id);

    values.push(id);
    this.db.prepare(`UPDATE custom_agents SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
    return this.getCustomAgent(id);
  }

  deleteCustomAgent(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM agent_env_profiles WHERE parent_agent_id = ?").run(id);
      this.db.prepare("DELETE FROM custom_agents WHERE id = ?").run(id);
    })();
  }

  private mapCustomAgent(row: Record<string, unknown>): CustomAgent {
    return {
      id: String(row.id),
      name: String(row.name),
      command: String(row.command),
      args: JSON.parse(String(row.args || "[]")),
      env: row.env ? JSON.parse(String(row.env)) : undefined,
      icon: row.icon == null ? undefined : String(row.icon),
      description: row.description == null ? undefined : String(row.description),
    };
  }

  // ── Agent Env Profiles ──────────────────────────────────────────

  createAgentEnvProfile(profile: Omit<AgentEnvProfile, "id"> & { id?: string }): AgentEnvProfile {
    const id = profile.id || `profile_${nanoid()}`;
    const now = this.getCurrentTimestamp();
    this.db.prepare(
      `INSERT INTO agent_env_profiles (id, parent_agent_id, name, env, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, profile.parentAgentId, profile.name, JSON.stringify(profile.env), now);
    return this.getAgentEnvProfile(id)!;
  }

  getAgentEnvProfile(id: string): AgentEnvProfile | null {
    const row = this.db
      .prepare("SELECT * FROM agent_env_profiles WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapAgentEnvProfile(row) : null;
  }

  listAgentEnvProfiles(parentAgentId?: string): AgentEnvProfile[] {
    if (parentAgentId) {
      return this.db
        .prepare("SELECT * FROM agent_env_profiles WHERE parent_agent_id = ? ORDER BY created_at ASC")
        .all(parentAgentId)
        .map((row: any) => this.mapAgentEnvProfile(row));
    }
    return this.db
      .prepare("SELECT * FROM agent_env_profiles ORDER BY created_at ASC")
      .all()
      .map((row: any) => this.mapAgentEnvProfile(row));
  }

  updateAgentEnvProfile(id: string, patch: Partial<Omit<AgentEnvProfile, "id" | "parentAgentId">>): AgentEnvProfile | null {
    const assignments: string[] = [];
    const values: Array<string | null> = [];

    if (patch.name !== undefined) { assignments.push("name = ?"); values.push(patch.name); }
    if (patch.env !== undefined) { assignments.push("env = ?"); values.push(JSON.stringify(patch.env)); }

    if (assignments.length === 0) return this.getAgentEnvProfile(id);

    values.push(id);
    this.db.prepare(`UPDATE agent_env_profiles SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
    return this.getAgentEnvProfile(id);
  }

  deleteAgentEnvProfile(id: string): void {
    this.db.prepare("DELETE FROM agent_env_profiles WHERE id = ?").run(id);
  }

  private mapAgentEnvProfile(row: Record<string, unknown>): AgentEnvProfile {
    return {
      id: String(row.id),
      parentAgentId: String(row.parent_agent_id),
      name: String(row.name),
      env: JSON.parse(String(row.env || "{}")),
    };
  }

  // ── History ───────────────────────────────────────────────────────

  appendHistory(
    sessionId: string,
    role: "user" | "agent",
    content: string,
    type: HistoryEntryType = "text",
    metadata?: Record<string, unknown> | null,
  ): void {
    const stmt = this.db.prepare(
      "INSERT INTO history (id, session_id, role, content, type, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    );
    stmt.run(
      nanoid(),
      sessionId,
      role,
      content,
      type,
      metadata ? JSON.stringify(metadata) : null,
    );
  }

  /**
   * Store a full session event (tool_call, plan, permission_request, etc.)
   * as a history entry with structured metadata.
   */
  appendEvent(
    sessionId: string,
    type: HistoryEntryType,
    data: Record<string, unknown>,
  ): void {
    let content = "";
    if (data.content == null) {
      content = "";
    } else if (typeof data.content === "string") {
      content = data.content;
    } else {
      content = JSON.stringify(data.content);
    }
    this.appendHistory(sessionId, "agent", content, type, data);
  }

  getHistory(sessionId: string): HistoryEntry[] {
    const stmt = this.db.prepare(
      "SELECT id, session_id, role, content, type, metadata, timestamp FROM history WHERE session_id = ? ORDER BY timestamp ASC"
    );
    return stmt.all(sessionId).map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      type: row.type || "text",
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      timestamp: row.timestamp,
    }));
  }

  close(): void {
    this.db.close();
  }

  /**
   * Map a session row that includes LEFT JOIN'd worktree columns
   * (wt_repository_id, wt_branch) to avoid N+1 queries.
   */
  private mapSessionRow(row: Record<string, unknown>): SessionInfo {
    const worktreeId = row.worktree_id == null ? null : String(row.worktree_id);
    return {
      sessionId: String(row.session_id),
      agentId: row.agent_id == null ? null : String(row.agent_id),
      profileId: row.profile_id == null ? null : String(row.profile_id),
      cwd: String(row.cwd),
      status: row.status as SessionInfo["status"],
      createdAt: String(row.created_at),
      recoverable: Boolean(row.recoverable),
      agentSessionId:
        row.agent_session_id == null ? null : String(row.agent_session_id),
      lastActiveAt: String(row.last_active_at ?? row.created_at),
      suspendedAt:
        row.suspended_at == null ? null : String(row.suspended_at),
      closeReason:
        row.close_reason == null ? null : String(row.close_reason),
      worktreeId,
      repositoryId: row.wt_repository_id == null ? null : String(row.wt_repository_id),
      branch: row.wt_branch == null ? null : String(row.wt_branch),
    };
  }

  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }
}
