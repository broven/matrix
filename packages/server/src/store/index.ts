import Database from "better-sqlite3";
import type { SessionInfo, HistoryEntry } from "@matrix/protocol";
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
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );
    `);
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

  appendHistory(sessionId: string, role: "user" | "agent", content: string): void {
    const stmt = this.db.prepare(
      "INSERT INTO history (id, session_id, role, content) VALUES (?, ?, ?, ?)"
    );
    stmt.run(nanoid(), sessionId, role, content);
  }

  getHistory(sessionId: string): HistoryEntry[] {
    const stmt = this.db.prepare(
      "SELECT id, session_id, role, content, timestamp FROM history WHERE session_id = ? ORDER BY timestamp ASC"
    );
    return stmt.all(sessionId).map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
    }));
  }

  close(): void {
    this.db.close();
  }
}
