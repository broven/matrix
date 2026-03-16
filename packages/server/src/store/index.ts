import { Database } from "bun:sqlite";
import type { SessionInfo, HistoryEntry, HistoryEntryType } from "@matrix/protocol";
import { nanoid } from "nanoid";

interface CreateSessionOptions {
  recoverable?: boolean;
  agentSessionId?: string | null;
  lastActiveAt?: string;
}

interface SessionStatePatch {
  status?: SessionInfo["status"];
  recoverable?: boolean;
  agentSessionId?: string | null;
  lastActiveAt?: string;
  suspendedAt?: string | null;
  closeReason?: string | null;
}

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        recoverable INTEGER NOT NULL DEFAULT 0,
        agent_session_id TEXT,
        last_active_at TEXT,
        suspended_at TEXT,
        close_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        metadata TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );
    `);

    const sessionColumns = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    const sessionColumnNames = sessionColumns.map((c) => c.name);

    if (!sessionColumnNames.includes("recoverable")) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN recoverable INTEGER NOT NULL DEFAULT 0`);
    }
    if (!sessionColumnNames.includes("agent_session_id")) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN agent_session_id TEXT`);
    }
    if (!sessionColumnNames.includes("last_active_at")) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN last_active_at TEXT`);
      this.db.exec(`UPDATE sessions SET last_active_at = created_at WHERE last_active_at IS NULL`);
    }
    if (!sessionColumnNames.includes("suspended_at")) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN suspended_at TEXT`);
    }
    if (!sessionColumnNames.includes("close_reason")) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN close_reason TEXT`);
    }

    // Migration: add type and metadata columns if they don't exist (for existing databases)
    const columns = this.db
      .prepare("PRAGMA table_info(history)")
      .all() as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);

    if (!columnNames.includes("type")) {
      this.db.exec(`ALTER TABLE history ADD COLUMN type TEXT NOT NULL DEFAULT 'text'`);
    }
    if (!columnNames.includes("metadata")) {
      this.db.exec(`ALTER TABLE history ADD COLUMN metadata TEXT`);
    }
  }

  createSession(
    sessionId: string,
    agentId: string,
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
        close_reason
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NULL, NULL)`
    );
    stmt.run(
      sessionId,
      agentId,
      cwd,
      now,
      options.recoverable ? 1 : 0,
      options.agentSessionId ?? null,
      now,
    );

    return this.getSession(sessionId)!;
  }

  listSessions(): SessionInfo[] {
    const stmt = this.db.prepare(
      `SELECT
        session_id,
        agent_id,
        cwd,
        status,
        created_at,
        recoverable,
        agent_session_id,
        last_active_at,
        suspended_at,
        close_reason
      FROM sessions
      ORDER BY created_at DESC`
    );
    return stmt.all().map((row: any) => this.mapSession(row));
  }

  closeSession(sessionId: string): void {
    this.updateSessionState(sessionId, {
      status: "closed",
      suspendedAt: null,
      closeReason: "user_closed",
    });
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM history WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
  }

  getSession(sessionId: string): SessionInfo | null {
    const stmt = this.db.prepare(
      `SELECT
        session_id,
        agent_id,
        cwd,
        status,
        created_at,
        recoverable,
        agent_session_id,
        last_active_at,
        suspended_at,
        close_reason
      FROM sessions
      WHERE session_id = ?`
    );
    const row = stmt.get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapSession(row) : null;
  }

  updateSessionState(sessionId: string, patch: SessionStatePatch): void {
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];

    if (patch.status !== undefined) {
      assignments.push("status = ?");
      values.push(patch.status);
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
    this.db.prepare(
      `UPDATE sessions
      SET status = 'suspended',
          suspended_at = COALESCE(suspended_at, ?),
          close_reason = NULL
      WHERE status != 'closed' AND recoverable = 1`
    ).run(now);

    this.db.prepare(
      `UPDATE sessions
      SET status = 'closed',
          suspended_at = NULL,
          close_reason = 'server_restart_unrecoverable'
      WHERE status != 'closed' AND recoverable = 0`
    ).run();
  }

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

  private mapSession(row: Record<string, unknown>): SessionInfo {
    return {
      sessionId: String(row.session_id),
      agentId: String(row.agent_id),
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
    };
  }

  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }
}
