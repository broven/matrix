# Database Migration System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ad-hoc column-check migrations with a versioned migration system using `PRAGMA user_version`, and fix the `agent_id NOT NULL` constraint bug that breaks session creation on upgraded databases.

**Architecture:** A `migrations` array of functions indexed by version number. On startup, read `PRAGMA user_version`, run all migrations from current version to latest, each wrapped in a transaction. v1 bootstraps the full schema (fresh install) or fixes legacy databases (upgrade).

**Tech Stack:** Bun + `bun:sqlite`, vitest for tests

**Design doc:** `docs/plans/2026-03-21-db-migration-design.md`

---

### Task 1: Write failing tests for the migration system

**Files:**
- Modify: `packages/server/src/__tests__/store.test.ts`

**Step 1: Write test — fresh install sets user_version**

Add a test that verifies a fresh `Store` on an empty database sets `user_version` to the latest version and creates all tables.

```typescript
it("fresh install: sets user_version and creates all tables", () => {
  // store is already created in beforeEach on a clean DB
  const raw = new Database(DB_PATH);
  const { user_version } = raw.prepare("PRAGMA user_version").get() as { user_version: number };
  expect(user_version).toBeGreaterThanOrEqual(1);

  // All tables exist
  const tables = raw.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map((r: any) => r.name);
  expect(tables).toContain("sessions");
  expect(tables).toContain("history");
  expect(tables).toContain("repositories");
  expect(tables).toContain("worktrees");
  expect(tables).toContain("custom_agents");
  expect(tables).toContain("agent_env_profiles");
  raw.close();
});
```

**Step 2: Write test — legacy upgrade makes agent_id nullable**

Add a test that creates a legacy database with `agent_id TEXT NOT NULL`, inserts data, then opens `Store` and verifies the data is preserved and `agent_id` can now be null.

```typescript
it("legacy upgrade: makes agent_id nullable and preserves data", () => {
  store.close();

  // Create legacy schema with NOT NULL agent_id
  const legacyDb = new Database(DB_PATH);
  legacyDb.exec(`
    DROP TABLE IF EXISTS history;
    DROP TABLE IF EXISTS sessions;
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
    INSERT INTO sessions (session_id, agent_id, cwd) VALUES ('sess_old', 'my-agent', '/tmp/old');
    INSERT INTO history (id, session_id, role, content) VALUES ('h1', 'sess_old', 'user', 'hello');
  `);
  // user_version is 0 by default (legacy)
  legacyDb.close();

  // Open store — should run migration
  store = new Store(DB_PATH);

  // Old data preserved
  const session = store.getSession("sess_old");
  expect(session).not.toBeNull();
  expect(session?.agentId).toBe("my-agent");
  expect(session?.cwd).toBe("/tmp/old");

  // History preserved
  const history = store.getHistory("sess_old");
  expect(history).toHaveLength(1);
  expect(history[0].content).toBe("hello");

  // Can now create session with null agent_id (the bug fix)
  const newSession = store.createSession("sess_new", null, "/tmp/new");
  expect(newSession.agentId).toBeNull();
});
```

**Step 3: Write test — already migrated DB skips migrations**

```typescript
it("already migrated: skips migration if user_version is current", () => {
  store.close();

  // Get the current version
  const raw = new Database(DB_PATH);
  const { user_version } = raw.prepare("PRAGMA user_version").get() as { user_version: number };
  raw.close();

  // Re-open — should not error, no-op migration
  store = new Store(DB_PATH);
  const sessions = store.listSessions();
  expect(sessions).toBeDefined();

  // Version unchanged
  const raw2 = new Database(DB_PATH);
  const result = raw2.prepare("PRAGMA user_version").get() as { user_version: number };
  expect(result.user_version).toBe(user_version);
  raw2.close();
});
```

**Step 4: Run tests to verify they fail**

Run: `cd packages/server && bun test`
Expected: The new tests should fail because migration system doesn't exist yet. The existing `"migrates older session tables"` test should still pass for now.

**Step 5: Commit**

```bash
git add packages/server/src/__tests__/store.test.ts
git commit -m "test: add migration system tests for fresh install, legacy upgrade, and idempotency"
```

---

### Task 2: Implement the migration system

**Files:**
- Modify: `packages/server/src/store/index.ts`

**Step 1: Replace `migrate()` with versioned migration system**

Replace the entire `migrate()` method with this implementation:

```typescript
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
```

**Step 2: Add the three helper methods for legacy upgrade**

Add these private methods to the `Store` class, right after `migrate()`:

```typescript
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
```

**Step 3: Run tests**

Run: `cd packages/server && bun test`
Expected: ALL tests pass, including new migration tests and existing tests.

**Step 4: Commit**

```bash
git add packages/server/src/store/index.ts
git commit -m "feat: versioned db migration system with PRAGMA user_version

Replaces ad-hoc column-check migrations with a versioned migration array.
Fixes NOT NULL constraint on sessions.agent_id that broke session creation
after upgrading from older versions."
```

---

### Task 3: Update the existing legacy migration test

**Files:**
- Modify: `packages/server/src/__tests__/store.test.ts`

**Step 1: Update the old migration test**

The existing test `"migrates older session tables without failing on lifecycle columns"` was testing the old ad-hoc migration. Update it to also verify `user_version` is set:

```typescript
it("migrates older session tables without failing on lifecycle columns", () => {
  store.close();

  const legacyDb = new Database(DB_PATH);
  legacyDb.exec(`
    DROP TABLE IF EXISTS history;
    DROP TABLE IF EXISTS sessions;
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
    INSERT INTO sessions (session_id, agent_id, cwd, status, created_at)
    VALUES ('sess_legacy', 'echo-agent', '/tmp/legacy', 'active', '2026-03-14 13:46:26');
  `);
  legacyDb.close();

  store = new Store(DB_PATH);

  const session = store.getSession("sess_legacy");
  expect(session).not.toBeNull();
  expect(session?.status).toBe("active");
  expect(session?.recoverable).toBe(false);
  expect(session?.agentSessionId).toBeNull();
  expect(session?.lastActiveAt).toBe("2026-03-14 13:46:26");

  // Verify migration version was set
  const raw = new Database(DB_PATH);
  const { user_version } = raw.prepare("PRAGMA user_version").get() as { user_version: number };
  expect(user_version).toBeGreaterThanOrEqual(1);
  raw.close();
});
```

**Step 2: Run tests**

Run: `cd packages/server && bun test`
Expected: ALL tests pass.

**Step 3: Commit**

```bash
git add packages/server/src/__tests__/store.test.ts
git commit -m "test: update legacy migration test to verify user_version is set"
```
