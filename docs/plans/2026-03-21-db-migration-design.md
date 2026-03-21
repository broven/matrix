# Database Migration System Design

## Problem

老版本 Matrix 的 `sessions` 表定义了 `agent_id TEXT NOT NULL`。新版本改为 `agent_id TEXT`（nullable）以支持 lazy agent 初始化。但 `CREATE TABLE IF NOT EXISTS` 不会修改已存在的表，导致老数据库保留 NOT NULL 约束，创建 session 时报错：

```
NOT NULL constraint failed: sessions.agent_id
```

现有的 migration 机制是一堆 ad-hoc 的 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` 检查，无法处理**修改列约束**这类操作。

## Solution

用 SQLite 内建的 `PRAGMA user_version` 追踪 schema 版本号，配合代码内的 migration 数组，按版本顺序执行。

### 核心机制

```typescript
private migrate(): void {
  const { user_version: currentVersion } =
    this.db.prepare("PRAGMA user_version").get() as { user_version: number };

  for (let i = currentVersion; i < migrations.length; i++) {
    this.db.transaction(() => {
      migrations[i](this.db);
      this.db.exec(`PRAGMA user_version = ${i + 1}`);
    })();
  }
}
```

- 每个 migration 是一个 `(db: Database) => void` 函数
- 每个 migration 包在 transaction 里，执行完 bump 版本号
- 崩溃/断电 → 未完成的 migration 自动回滚，下次启动重跑
- `PRAGMA user_version` 存在 SQLite 文件头，零开销

### 处理老数据库（user_version = 0）

老版本数据库没有设过 `user_version`，默认值是 0。但老数据库的 schema 已经通过 ad-hoc migration 跑到了"当前最新"状态（只差 `agent_id` 约束问题）。

策略：**把历史打平**。

- **v1（`user_version = 0 → 1`）**：一次性 fixup migration
  1. 用 `PRAGMA table_info` 检测是否已有 `sessions` 表
  2. 有表 → 补缺失列 + rebuild sessions 表修复 `agent_id` 约束
  3. 无表 → 全新创建所有表（当前完整 schema）
- **v2+**：未来新 migration 正常写

### v1 Migration 详细逻辑

#### 新安装（无 sessions 表）

直接创建所有表，使用当前最新 schema：

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  agent_id TEXT,              -- nullable
  cwd TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  recoverable INTEGER NOT NULL DEFAULT 0,
  agent_session_id TEXT,
  last_active_at TEXT,
  suspended_at TEXT,
  close_reason TEXT,
  worktree_id TEXT REFERENCES worktrees(id),
  profile_id TEXT
);
-- ... history, repositories, worktrees, custom_agents, agent_env_profiles
```

#### 老版本升级（有 sessions 表，user_version = 0）

1. **补缺失列**：沿用现有逻辑，检测并 ADD COLUMN（`worktree_id`, `profile_id` 等）
2. **补缺失表**：`CREATE TABLE IF NOT EXISTS` 保证 `repositories`, `worktrees`, `custom_agents`, `agent_env_profiles` 存在
3. **修复 agent_id 约束**：SQLite 不支持 `ALTER COLUMN`，需要 table rebuild：

```sql
-- 1. 创建新表
CREATE TABLE sessions_new (
  session_id TEXT PRIMARY KEY,
  agent_id TEXT,              -- 关键：去掉 NOT NULL
  cwd TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  recoverable INTEGER NOT NULL DEFAULT 0,
  agent_session_id TEXT,
  last_active_at TEXT,
  suspended_at TEXT,
  close_reason TEXT,
  worktree_id TEXT REFERENCES worktrees(id),
  profile_id TEXT
);

-- 2. 复制数据
INSERT INTO sessions_new SELECT
  session_id, agent_id, cwd, status, created_at,
  recoverable, agent_session_id, last_active_at,
  suspended_at, close_reason, worktree_id, profile_id
FROM sessions;

-- 3. 替换
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
```

注意：`history` 表的外键 `REFERENCES sessions(session_id)` 不受影响，因为 SQLite 默认不强制外键约束（除非 `PRAGMA foreign_keys = ON`）。

### Migration 数组结构

```typescript
type Migration = (db: Database) => void;

const migrations: Migration[] = [
  // v1: bootstrap — 新安装创建全部表；老版本补列 + 修复 agent_id 约束
  (db) => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
    ).all();

    if (tables.length === 0) {
      // 新安装：创建完整 schema
      db.exec(`CREATE TABLE sessions (...); CREATE TABLE history (...); ...`);
    } else {
      // 老版本升级：补列 + rebuild
      ensureMissingColumns(db);
      ensureMissingTables(db);
      rebuildSessionsTable(db);
    }
  },

  // v2+: 未来的 migration 示例
  // (db) => { db.exec(`ALTER TABLE sessions ADD COLUMN foo TEXT`); },
];
```

### 测试计划

1. **新安装**：空数据库 → 启动后所有表存在，`user_version = 1`
2. **老版本升级（有数据）**：用老 schema 插入测试数据 → 升级后数据完整，`agent_id` 可为 null，`user_version = 1`
3. **已是最新版本**：`user_version = 1` → migration 不执行，无副作用
4. **幂等性**：连续重启多次，结果一致

### 文件变更

只改一个文件：`packages/server/src/store/index.ts`

- 删除现有 `migrate()` 方法中的所有 ad-hoc 逻辑
- 替换为 `PRAGMA user_version` + migration 数组模式
- 提取 `ensureMissingColumns()`, `ensureMissingTables()`, `rebuildSessionsTable()` 为私有方法（仅在 v1 中使用）
