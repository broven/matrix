# Multi-Server Architecture & Settings Redesign

## Overview

支持同时连接多个 Matrix Server（如本地 Mac + 远端 Linux VPS），所有客户端（Web、Mac、iPhone）启动时并行连接所有已保存的 server，实时接收各 server 的更新。Settings 页面为每个 server 提供独立配置界面。

## 使用场景

- 用户有多台设备：Mac（本地 Internal Server）+ Linux VPS（远端 Server）
- 客户端（Web / Mac / iPhone）同时连接所有 server
- 在 Mac 上触发 ACPClient 执行，iPhone 上打开同一 Session 能实时看到运行状况并交互
- 电脑休眠恢复后，自动同步期间其他客户端产生的变更

---

## Layer 1: SDK — ClientManager

新增 `ClientManager` 管理多个 `MatrixClient` 实例，每个实例独立连接一个 server。

```typescript
// packages/sdk/src/client-manager.ts

class ClientManager {
  private clients = new Map<string, MatrixClient>();

  connect(serverId: string, config: { serverUrl: string; token: string }): MatrixClient;
  disconnect(serverId: string): void;
  getClient(serverId: string): MatrixClient | null;
  getConnectedClients(): Map<string, MatrixClient>;
  disconnectAll(): void;
  onStatusChange(callback: (serverId: string, status: ConnectionStatus) => void): void;
}
```

不做 federation、不做跨 server 同步。每个 `MatrixClient` 独立维护 transport 和 session map。

---

## Layer 2: React Context — 多 Client Provider

去掉 "active server" 概念，所有 server 平等并行。

```typescript
// useMatrixClients.tsx (新)

interface MatrixClientsContext {
  clients: Map<string, MatrixClient>;
  statuses: Map<string, ConnectionStatus>;
  errors: Map<string, string | null>;

  connect(serverId: string, config: { serverUrl: string; token: string }): Promise<void>;
  disconnect(serverId: string): void;
  getClient(serverId: string): MatrixClient | null;
}
```

旧 `useMatrixClient()` 改为接受 `serverId` 参数：

```typescript
function useMatrixClient(serverId: string) {
  const { getClient, statuses, errors } = useMatrixClients();
  return {
    client: getClient(serverId),
    status: statuses.get(serverId) ?? "offline",
    error: errors.get(serverId) ?? null,
  };
}
```

Provider 树：

```
MatrixClientsProvider
  └── ServerStoreProvider
        └── AppContent
```

---

## Layer 3: 数据层 — 按 Server 分区 + 实时同步

### useServerData hook

```typescript
interface ServerData {
  agents: AgentListItem[];
  sessions: SessionInfo[];
  repositories: RepositoryInfo[];
  worktrees: Map<string, WorktreeInfo[]>;
  serverConfig: ServerConfig | null;
  loading: boolean;
}

function useServerData(serverId: string): ServerData;
```

每个 server 独立加载和管理数据。

### 同步策略

- **在线时**：增量推送（尽力而为，不保证可靠送达）
- **恢复时**：全量刷新（WebSocket 重连 / App 恢复 → 调用 REST API 拉全量）
- **数据权威性**：Server 是 single source of truth，客户端不做持久化缓存

### 增量推送事件（在线时）

Server 在以下操作时通过 WebSocket 推送给所有已连接 client：

```typescript
| { type: "server:session_created"; session: SessionInfo }
| { type: "server:session_closed"; sessionId: string }
| { type: "server:repository_added"; repository: RepositoryInfo }
| { type: "server:repository_removed"; repositoryId: string }
| { type: "server:agent_created"; agent: AgentListItem }
| { type: "server:agent_updated"; agent: AgentListItem }
| { type: "server:agent_removed"; agentId: string }
```

增量推送无 eventId，不做重放保证。丢了由全量刷新兜底。

### 全量刷新（恢复时）

WebSocket 重连成功或 `visibilitychange` → visible 时，对每个 server 调用：
- `client.getSessions()`
- `client.getRepositories()`
- `client.getAgents()`

用返回结果直接替换本地状态。

### 脏数据处理

- 所有列表以 server 返回为准，直接替换本地
- 当前打开的 session 被远端删除时：
  1. 从本地状态移除
  2. 跳转到同 server 的最近 session
  3. 如该 server 无 session，清空主区域

### Selected Session

复合 key 标识：

```typescript
interface SelectedSession {
  serverId: string;
  sessionId: string;
}
```

---

## Layer 4: 协议层变更

### ConnectionManager 新增

```typescript
// 现有：broadcastToSession(sessionId, message) — 发给订阅了该 session 的 client
// 新增：broadcastToAll(message) — 发给所有已连接 client
broadcastToAll(message: ServerMessage): void;
```

### 广播时机

```
POST /sessions            → broadcastToAll(server:session_created)
DELETE /sessions/{id}     → broadcastToAll(server:session_closed)
POST /repositories        → broadcastToAll(server:repository_added)
DELETE /repositories/{id} → broadcastToAll(server:repository_removed)
Agent CRUD endpoints      → broadcastToAll(对应 agent 事件)
```

### MatrixClient SDK 新增

```typescript
client.onServerEvent(callback: (event: ServerEvent) => void): void;
```

---

## Layer 5: Sidebar 改造

从扁平 repos 列表改为按 server 分组的树形结构：

```
── Mac (local) ●  ────────── server section, ● = 连接状态指示
  ▸ Repo A
      worktree-1
        Session "fix bug"
        Session "refactor"
      worktree-2
  ▸ Repo B
── Linux VPS ●  ──────────
  ▸ Repo C
      worktree-3
        Session "deploy"

[Settings ⚙]
```

### 交互

- 每个 server header 显示名称 + 连接状态（绿/灰/红点）
- 点击 session → 主区域打开该 session（携带 serverId）
- Server 连接失败 → 该 section 显示错误 + 重连按钮，不影响其他 server
- Server 断开 → 该 section 折叠，灰色状态

### 组件结构

```typescript
function ServerSection({ serverId }: { serverId: string }) {
  const { repositories, worktrees, loading } = useServerData(serverId);
  const { status } = useMatrixClient(serverId);
  // 渲染该 server 的 repos → worktrees → sessions 树
}
```

---

## Layer 6: Settings 页面改造

### Settings Sidebar

```
[General]
── Servers ──
  Mac (local)
  Linux VPS
  Add Server...
── Repositories ──
  Repo A
  Repo B
```

### SettingsTab 类型

```typescript
type SettingsTab =
  | { kind: "general" }
  | { kind: "server"; serverId: string }
  | { kind: "new-server" }
  | { kind: "repository"; repositoryId: string };
```

移除 `{ kind: "agents" }`，agents 归入各 server 配置页。

### General Tab

仅保留：
- About（版本号、更新通道、检查更新）
- 全局 UI 偏好（未来扩展）

### Server 配置页

每个 server 的配置页分为以下 card：

1. **Connection** — 名称、URL、Token、连接状态/错误、连接/断开按钮
2. **Server Configuration** — reposPath、worktreesPath（带 browse）
3. **Agents** — 内置 agents + 自定义 agents CRUD + profiles
4. **Danger Zone** — 删除 server（断开 + 移除）

### Add Server 流程

1. 点击 "Add Server..." → sidebar 高亮 "New Server" 条目
2. 主区域显示空白配置页，Connection card 可编辑
3. 填写后点 Save → 后台测试连接可用性
4. 成功 → 保存并加载配置；失败 → 显示错误，可修改重试

### Server 配置页打开已有 server

- 立即展示已保存的连接信息（名称、URL）
- 同时后台尝试连接
- 连接成功 → 加载并展示 Server Configuration 和 Agents
- 连接失败 → 显示错误提示

---

## Layer 7: SessionView 改造

```typescript
interface SessionViewProps {
  serverId: string;
  sessionInfo: SessionInfo;
  // ...其他现有 props
}

function SessionView({ serverId, sessionInfo }: SessionViewProps) {
  const { client } = useMatrixClient(serverId);
  const session = client?.attachSession(sessionInfo.sessionId);
  // 其余逻辑不变
}
```

跨 server session 切换无缝 — 通过 `serverId` 拿到对应 client 实例。

---

## Layer 8: 连接生命周期

### App 启动

```typescript
useEffect(() => {
  for (const server of savedServers) {
    clients.connect(server.id, {
      serverUrl: server.serverUrl,
      token: server.token,
    }); // 非阻塞，各自独立
  }
}, []);
```

并行连接所有已保存 server，不再是"恢复上次连接"。

### 休眠恢复

```typescript
function useConnectionRecovery() {
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        // 对每个 server 全量刷新元数据
        for (const [serverId] of clients) {
          refreshServerData(serverId);
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);
  // WebSocket 层：transport 自动重连 + lastEventId 重放 session 内容
}
```

### 断线展示

- 单个 server 断线 → 该 section 显示指示器，不影响其他
- 全部断线 → 所有 section 离线状态，不跳 ConnectPage（会自动重连）
- WebSocket 层已有指数退避重连（最大 30s）
