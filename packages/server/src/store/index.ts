import Database from "better-sqlite3";
import type { SessionInfo, HistoryEntry, HistoryEntryType } from "@matrix/protocol";
import { nanoid } from "nanoid";

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  createSession(sessionId: string, agentId: string, cwd: string): SessionInfo {
    const stmt = this.db.prepare(
      "INSERT INTO sessions (session_id, agent_id, cwd) VALUES (?, ?, ?)"
    );
    stmt.run(sessionId, agentId, cwd);

    return {
      sessionId,
      agentId,
      cwd,
      createdAt: new Date().toISOString(),
      status: "active",
    };
  }

  listSessions(): SessionInfo[] {
    const stmt = this.db.prepare(
      "SELECT session_id, agent_id, cwd, status, created_at FROM sessions ORDER BY created_at DESC"
    );
    return stmt.all().map((row: any) => ({
      sessionId: row.session_id,
      agentId: row.agent_id,
      cwd: row.cwd,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  closeSession(sessionId: string): void {
    const stmt = this.db.prepare(
      "UPDATE sessions SET status = 'closed' WHERE session_id = ?"
    );
    stmt.run(sessionId);
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
    const content = data.content != null ? String(data.content) : "";
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
}
