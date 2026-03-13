# Matrix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a pnpm monorepo with 4 packages (@matrix/protocol, @matrix/sdk, @matrix/server, @matrix/client) that enables remote control of ACP-compatible CodeAgents.

**Architecture:** Server manages ACP agent child processes via stdio, bridges them to remote clients over WebSocket + REST (Hono). SDK encapsulates client-server communication. Tauri v2 + React client targets macOS, iOS, Android, and web.

**Tech Stack:** TypeScript, pnpm workspaces, Hono, Tauri v2, React, SQLite (better-sqlite3), @agentclientprotocol/sdk, vitest

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`

**Step 1: Create root package.json**

```json
{
  "name": "matrix",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "dev": "pnpm -r --parallel dev"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

**Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

**Step 4: Create packages/protocol/package.json**

```json
{
  "name": "@matrix/protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

**Step 5: Create packages/protocol/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 6: Create packages/sdk/package.json**

```json
{
  "name": "@matrix/sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run"
  },
  "dependencies": {
    "@matrix/protocol": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 7: Create packages/sdk/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 8: Create packages/server/package.json**

```json
{
  "name": "@matrix/server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@matrix/protocol": "workspace:*",
    "@agentclientprotocol/sdk": "^0.1.0",
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0",
    "@hono/node-ws": "^1.1.0",
    "better-sqlite3": "^11.8.0",
    "nanoid": "^5.1.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 9: Create packages/server/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

**Step 10: Install dependencies**

Run: `pnpm install`
Expected: All dependencies resolved, lockfile created

**Step 11: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json packages/protocol/ packages/sdk/ packages/server/ pnpm-lock.yaml
git commit -m "feat: scaffold pnpm monorepo with protocol, sdk, and server packages"
```

---

## Task 2: @matrix/protocol — Core Type Definitions

**Files:**
- Create: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/session.ts`
- Create: `packages/protocol/src/agent.ts`
- Create: `packages/protocol/src/transport.ts`
- Create: `packages/protocol/src/api.ts`

**Step 1: Create session types**

File: `packages/protocol/src/session.ts`

```typescript
/** Unique session identifier */
export type SessionId = string;

/** Unique tool call identifier */
export type ToolCallId = string;

/** Session mode */
export interface SessionMode {
  id: string;
  name: string;
  description: string;
}

/** Session modes info */
export interface SessionModes {
  currentModeId: string;
  availableModes: SessionMode[];
}

/** Stop reason when a prompt turn ends */
export type StopReason = "end_turn" | "cancelled";

/** Prompt content can be text or a resource */
export type PromptContent =
  | { type: "text"; text: string }
  | { type: "resource"; resource: PromptResource };

export interface PromptResource {
  uri: string;
  mimeType: string;
  text: string;
}

/** Tool call kinds */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other";

/** Tool call status */
export type ToolCallStatus = "pending" | "running" | "completed" | "error";

/** Tool call location */
export interface ToolCallLocation {
  path: string;
}

/** Tool call content */
export type ToolCallContent =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText: string; newText: string };

/** Plan entry */
export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/** Permission option kinds */
export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

/** Permission option */
export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

/** Permission outcome */
export type PermissionOutcome =
  | { outcome: "cancelled" }
  | { outcome: "selected"; optionId: string };

/** Session update types sent from server to client */
export type SessionUpdate =
  | {
      sessionUpdate: "agent_message_chunk";
      content: { type: "text"; text: string };
    }
  | {
      sessionUpdate: "plan";
      entries: PlanEntry[];
    }
  | {
      sessionUpdate: "tool_call";
      toolCallId: ToolCallId;
      title: string;
      kind: ToolKind;
      status: ToolCallStatus;
      locations?: ToolCallLocation[];
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: ToolCallId;
      status: ToolCallStatus;
      content?: ToolCallContent[];
    }
  | {
      sessionUpdate: "permission_request";
      toolCallId: ToolCallId;
      toolCall: {
        toolCallId: ToolCallId;
        title: string;
        kind: ToolKind;
        status: ToolCallStatus;
        content?: ToolCallContent[];
      };
      options: PermissionOption[];
    }
  | {
      sessionUpdate: "completed";
      stopReason: StopReason;
    };
```

**Step 2: Create agent types**

File: `packages/protocol/src/agent.ts`

```typescript
/** Agent configuration — how to start an ACP agent */
export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Agent info returned after ACP initialize */
export interface AgentInfo {
  name: string;
  title?: string;
  version?: string;
}

/** Agent capabilities returned after ACP initialize */
export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
}
```

**Step 3: Create transport types**

File: `packages/protocol/src/transport.ts`

```typescript
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
  | { type: "session:update"; sessionId: string; update: import("./session.js").SessionUpdate; eventId: string }
  | { type: "session:created"; sessionId: string; modes: import("./session.js").SessionModes }
  | { type: "session:closed"; sessionId: string }
  | { type: "error"; code: string; message: string };

/** WebSocket message envelope from client to server */
export type ClientMessage =
  | { type: "session:prompt"; sessionId: string; prompt: import("./session.js").PromptContent[] }
  | { type: "session:permission_response"; sessionId: string; toolCallId: string; outcome: import("./session.js").PermissionOutcome }
  | { type: "ping" };
```

**Step 4: Create REST API types**

File: `packages/protocol/src/api.ts`

```typescript
import type { AgentConfig, AgentInfo } from "./agent.js";
import type { SessionModes, SessionId } from "./session.js";

/** POST /sessions request */
export interface CreateSessionRequest {
  agentId: string;
  cwd: string;
}

/** POST /sessions response */
export interface CreateSessionResponse {
  sessionId: SessionId;
  modes: SessionModes;
}

/** GET /sessions response item */
export interface SessionInfo {
  sessionId: SessionId;
  agentId: string;
  cwd: string;
  createdAt: string;
  status: "active" | "closed";
}

/** GET /agents response item */
export interface AgentListItem {
  id: string;
  name: string;
  command: string;
  available: boolean;
}

/** GET /sessions/:id/history response item */
export interface HistoryEntry {
  id: string;
  sessionId: SessionId;
  timestamp: string;
  role: "user" | "agent";
  content: string;
}

/** Auth token response */
export interface AuthTokenInfo {
  token: string;
  expiresAt?: string;
}
```

**Step 5: Create barrel export**

File: `packages/protocol/src/index.ts`

```typescript
export * from "./session.js";
export * from "./agent.js";
export * from "./transport.js";
export * from "./api.js";
```

**Step 6: Build and verify**

Run: `cd packages/protocol && pnpm build`
Expected: Compiles without errors, `dist/` created with `.js` and `.d.ts` files

**Step 7: Commit**

```bash
git add packages/protocol/
git commit -m "feat(protocol): add core ACP type definitions"
```

---

## Task 3: @matrix/server — Auth Module

**Files:**
- Create: `packages/server/src/auth/token.ts`
- Create: `packages/server/src/auth/middleware.ts`
- Test: `packages/server/src/__tests__/auth.test.ts`

**Step 1: Write the failing test**

File: `packages/server/src/__tests__/auth.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { generateToken, validateToken } from "../auth/token.js";

describe("auth/token", () => {
  it("generates a token string", () => {
    const token = generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  it("validates a correct token", () => {
    const token = generateToken();
    expect(validateToken(token, token)).toBe(true);
  });

  it("rejects an incorrect token", () => {
    const token = generateToken();
    expect(validateToken("wrong-token", token)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: FAIL — module not found

**Step 3: Implement token module**

File: `packages/server/src/auth/token.ts`

```typescript
import { nanoid } from "nanoid";
import { timingSafeEqual } from "node:crypto";

export function generateToken(): string {
  return nanoid(48);
}

export function validateToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return timingSafeEqual(a, b);
}
```

**Step 4: Implement auth middleware**

File: `packages/server/src/auth/middleware.ts`

```typescript
import { createMiddleware } from "hono/factory";
import { validateToken } from "./token.js";

export function authMiddleware(serverToken: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }
    const token = header.slice(7);
    if (!validateToken(token, serverToken)) {
      return c.json({ error: "Invalid token" }, 401);
    }
    await next();
  });
}
```

**Step 5: Run tests**

Run: `cd packages/server && pnpm test`
Expected: All 3 tests PASS

**Step 6: Commit**

```bash
git add packages/server/src/auth/ packages/server/src/__tests__/auth.test.ts
git commit -m "feat(server): add token auth generation and middleware"
```

---

## Task 4: @matrix/server — Agent Manager

**Files:**
- Create: `packages/server/src/agent-manager/index.ts`
- Create: `packages/server/src/agent-manager/config.ts`
- Test: `packages/server/src/__tests__/agent-manager.test.ts`

**Step 1: Write the failing test**

File: `packages/server/src/__tests__/agent-manager.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { AgentManager } from "../agent-manager/index.js";
import type { AgentConfig } from "@matrix/protocol";

const testConfig: AgentConfig = {
  id: "echo-agent",
  name: "Echo Agent",
  command: "cat",
  args: [],
};

describe("AgentManager", () => {
  let manager: AgentManager;

  beforeEach(() => {
    manager = new AgentManager();
  });

  it("registers an agent config", () => {
    manager.register(testConfig);
    const agents = manager.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("echo-agent");
  });

  it("checks agent availability", () => {
    manager.register(testConfig);
    const agents = manager.listAgents();
    expect(agents[0].available).toBe(true);
  });

  it("spawns a process and returns a handle", async () => {
    manager.register(testConfig);
    const handle = manager.spawn("echo-agent", "/tmp");
    expect(handle).toBeDefined();
    expect(handle.process.pid).toBeDefined();
    handle.process.kill();
  });

  it("throws on unknown agent id", () => {
    expect(() => manager.spawn("nonexistent", "/tmp")).toThrow("Unknown agent");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: FAIL — module not found

**Step 3: Create agent config loader**

File: `packages/server/src/agent-manager/config.ts`

```typescript
import type { AgentConfig } from "@matrix/protocol";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Check if an agent's command is available on the system.
 */
export function isAgentAvailable(config: AgentConfig): boolean {
  // Check if command exists as absolute path
  if (config.command.startsWith("/")) {
    return existsSync(config.command);
  }
  // For relative/bare commands, assume available (PATH lookup happens at spawn)
  return true;
}
```

**Step 4: Implement AgentManager**

File: `packages/server/src/agent-manager/index.ts`

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import type { AgentConfig, AgentListItem } from "@matrix/protocol";
import { isAgentAvailable } from "./config.js";

export interface AgentHandle {
  agentId: string;
  process: ChildProcess;
  cwd: string;
}

export class AgentManager {
  private configs = new Map<string, AgentConfig>();

  register(config: AgentConfig): void {
    this.configs.set(config.id, config);
  }

  listAgents(): AgentListItem[] {
    return Array.from(this.configs.values()).map((config) => ({
      id: config.id,
      name: config.name,
      command: config.command,
      available: isAgentAvailable(config),
    }));
  }

  spawn(agentId: string, cwd: string): AgentHandle {
    const config = this.configs.get(agentId);
    if (!config) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const child = spawn(config.command, config.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...config.env },
    });

    return {
      agentId,
      process: child,
      cwd,
    };
  }

  getConfig(agentId: string): AgentConfig | undefined {
    return this.configs.get(agentId);
  }
}
```

**Step 5: Run tests**

Run: `cd packages/server && pnpm test`
Expected: All 4 tests PASS

**Step 6: Commit**

```bash
git add packages/server/src/agent-manager/ packages/server/src/__tests__/agent-manager.test.ts
git commit -m "feat(server): add AgentManager for spawning ACP agent processes"
```

---

## Task 5: @matrix/server — ACP Bridge (stdio ↔ JSON-RPC)

**Files:**
- Create: `packages/server/src/acp-bridge/index.ts`
- Create: `packages/server/src/acp-bridge/jsonrpc.ts`
- Test: `packages/server/src/__tests__/acp-bridge.test.ts`

**Step 1: Write the failing test**

File: `packages/server/src/__tests__/acp-bridge.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { encodeJsonRpc, parseJsonRpcMessages } from "../acp-bridge/jsonrpc.js";

describe("jsonrpc", () => {
  it("encodes a JSON-RPC request", () => {
    const encoded = encodeJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(encoded).toContain("Content-Length:");
    expect(encoded).toContain('"jsonrpc":"2.0"');
  });

  it("parses a single JSON-RPC message from buffer", () => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const raw = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
    const { messages, remainder } = parseJsonRpcMessages(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].result).toEqual({ ok: true });
    expect(remainder).toBe("");
  });

  it("handles partial messages", () => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} });
    const raw = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg.slice(0, 5)}`;
    const { messages, remainder } = parseJsonRpcMessages(raw);
    expect(messages).toHaveLength(0);
    expect(remainder.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: FAIL — module not found

**Step 3: Implement JSON-RPC encoder/parser**

File: `packages/server/src/acp-bridge/jsonrpc.ts`

```typescript
export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function encodeJsonRpc(message: JsonRpcMessage): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

export function parseJsonRpcMessages(buffer: string): {
  messages: JsonRpcMessage[];
  remainder: string;
} {
  const messages: JsonRpcMessage[] = [];
  let pos = 0;

  while (pos < buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n", pos);
    if (headerEnd === -1) break;

    const header = buffer.slice(pos, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;

    if (bodyEnd > buffer.length) break;

    const body = buffer.slice(bodyStart, bodyEnd);
    messages.push(JSON.parse(body));
    pos = bodyEnd;
  }

  return { messages, remainder: buffer.slice(pos) };
}
```

**Step 4: Implement ACP Bridge**

File: `packages/server/src/acp-bridge/index.ts`

```typescript
import type { ChildProcess } from "node:child_process";
import type { SessionUpdate, SessionId } from "@matrix/protocol";
import { encodeJsonRpc, parseJsonRpcMessages, type JsonRpcMessage } from "./jsonrpc.js";

export type BridgeEventHandler = {
  onSessionUpdate: (sessionId: SessionId, update: SessionUpdate) => void;
  onPermissionRequest: (sessionId: SessionId, request: JsonRpcMessage) => void;
  onError: (error: Error) => void;
  onClose: () => void;
};

/**
 * Bridges a stdio-based ACP agent process to structured events.
 * Handles JSON-RPC message framing over stdin/stdout.
 */
export class AcpBridge {
  private buffer = "";
  private nextId = 1;
  private pendingRequests = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    private process: ChildProcess,
    private handlers: BridgeEventHandler,
  ) {
    this.process.stdout!.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr!.on("data", (data: Buffer) => {
      // Log agent stderr for debugging
      console.error(`[agent stderr] ${data.toString()}`);
    });

    this.process.on("close", () => {
      this.handlers.onClose();
    });

    this.process.on("error", (err) => {
      this.handlers.onError(err);
    });
  }

  /** Send a JSON-RPC request and wait for response */
  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    this.write(message);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  /** Send a JSON-RPC notification (no response expected) */
  notify(method: string, params: unknown): void {
    const message: JsonRpcMessage = { jsonrpc: "2.0", method, params };
    this.write(message);
  }

  /** Initialize the ACP connection */
  async initialize(clientInfo: { name: string; version: string }): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo,
    });
  }

  /** Create a new session */
  async createSession(cwd: string): Promise<unknown> {
    return this.request("session/new", { cwd });
  }

  /** Send a prompt */
  async sendPrompt(sessionId: SessionId, prompt: Array<{ type: string; text: string }>): Promise<unknown> {
    return this.request("session/prompt", { sessionId, prompt });
  }

  /** Respond to a permission request */
  respondPermission(requestId: number | string, outcome: { outcome: string; optionId?: string }): void {
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: requestId,
      result: { outcome },
    };
    this.write(message);
  }

  destroy(): void {
    this.process.kill();
  }

  private write(message: JsonRpcMessage): void {
    const encoded = encodeJsonRpc(message);
    this.process.stdin!.write(encoded);
  }

  private processBuffer(): void {
    const { messages, remainder } = parseJsonRpcMessages(this.buffer);
    this.buffer = remainder;

    for (const msg of messages) {
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    // Response to a pending request
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Notification from agent
    if (msg.method === "session/update" && msg.params) {
      const params = msg.params as { sessionId: string; update: SessionUpdate };
      this.handlers.onSessionUpdate(params.sessionId, params.update);
      return;
    }

    // Permission request from agent (this is a request, needs response)
    if (msg.method === "session/request_permission" && msg.id !== undefined) {
      this.handlers.onPermissionRequest(
        (msg.params as { sessionId: string }).sessionId,
        msg,
      );
      return;
    }
  }
}
```

**Step 5: Run tests**

Run: `cd packages/server && pnpm test`
Expected: All tests PASS (jsonrpc unit tests)

**Step 6: Commit**

```bash
git add packages/server/src/acp-bridge/ packages/server/src/__tests__/acp-bridge.test.ts
git commit -m "feat(server): add ACP bridge for stdio JSON-RPC communication"
```

---

## Task 6: @matrix/server — SQLite Store

**Files:**
- Create: `packages/server/src/store/index.ts`
- Test: `packages/server/src/__tests__/store.test.ts`

**Step 1: Write the failing test**

File: `packages/server/src/__tests__/store.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../store/index.js";
import { unlinkSync } from "node:fs";

const DB_PATH = "/tmp/matrix-test.db";

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(DB_PATH);
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(DB_PATH); } catch {}
  });

  it("creates a session", () => {
    const session = store.createSession("sess_1", "echo-agent", "/tmp/project");
    expect(session.sessionId).toBe("sess_1");
    expect(session.status).toBe("active");
  });

  it("lists active sessions", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.createSession("sess_2", "echo-agent", "/tmp/b");
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(2);
  });

  it("closes a session", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.closeSession("sess_1");
    const sessions = store.listSessions();
    expect(sessions[0].status).toBe("closed");
  });

  it("appends and retrieves history", () => {
    store.createSession("sess_1", "echo-agent", "/tmp/a");
    store.appendHistory("sess_1", "user", "hello");
    store.appendHistory("sess_1", "agent", "hi there");
    const history = store.getHistory("sess_1");
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[1].content).toBe("hi there");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: FAIL — module not found

**Step 3: Implement Store**

File: `packages/server/src/store/index.ts`

```typescript
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
```

**Step 4: Run tests**

Run: `cd packages/server && pnpm test`
Expected: All 4 store tests PASS

**Step 5: Commit**

```bash
git add packages/server/src/store/ packages/server/src/__tests__/store.test.ts
git commit -m "feat(server): add SQLite store for sessions and history"
```

---

## Task 7: @matrix/server — REST API Routes

**Files:**
- Create: `packages/server/src/api/rest/agents.ts`
- Create: `packages/server/src/api/rest/sessions.ts`
- Create: `packages/server/src/api/rest/index.ts`
- Test: `packages/server/src/__tests__/api-rest.test.ts`

**Step 1: Write the failing test**

File: `packages/server/src/__tests__/api-rest.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createRestRoutes } from "../api/rest/index.js";
import { AgentManager } from "../agent-manager/index.js";
import { Store } from "../store/index.js";
import { unlinkSync } from "node:fs";

const DB_PATH = "/tmp/matrix-rest-test.db";

describe("REST API", () => {
  let app: Hono;
  let store: Store;

  beforeEach(() => {
    try { unlinkSync(DB_PATH); } catch {}
    const agentManager = new AgentManager();
    agentManager.register({
      id: "test-agent",
      name: "Test Agent",
      command: "echo",
      args: [],
    });
    store = new Store(DB_PATH);
    app = new Hono();
    app.route("/", createRestRoutes(agentManager, store));
  });

  it("GET /agents returns registered agents", async () => {
    const res = await app.request("/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("test-agent");
  });

  it("GET /sessions returns empty list initially", async () => {
    const res = await app.request("/sessions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("GET /sessions/:id/history returns 404 for unknown session", async () => {
    const res = await app.request("/sessions/unknown/history");
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test`
Expected: FAIL — module not found

**Step 3: Implement REST routes**

File: `packages/server/src/api/rest/agents.ts`

```typescript
import { Hono } from "hono";
import type { AgentManager } from "../../agent-manager/index.js";

export function agentRoutes(agentManager: AgentManager) {
  const app = new Hono();

  app.get("/agents", (c) => {
    return c.json(agentManager.listAgents());
  });

  return app;
}
```

File: `packages/server/src/api/rest/sessions.ts`

```typescript
import { Hono } from "hono";
import type { Store } from "../../store/index.js";

export function sessionRoutes(store: Store) {
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

  app.delete("/sessions/:id", (c) => {
    const sessionId = c.req.param("id");
    store.closeSession(sessionId);
    return c.json({ ok: true });
  });

  return app;
}
```

File: `packages/server/src/api/rest/index.ts`

```typescript
import { Hono } from "hono";
import type { AgentManager } from "../../agent-manager/index.js";
import type { Store } from "../../store/index.js";
import { agentRoutes } from "./agents.js";
import { sessionRoutes } from "./sessions.js";

export function createRestRoutes(agentManager: AgentManager, store: Store) {
  const app = new Hono();
  app.route("/", agentRoutes(agentManager));
  app.route("/", sessionRoutes(store));
  return app;
}
```

**Step 4: Run tests**

Run: `cd packages/server && pnpm test`
Expected: All 3 REST tests PASS

**Step 5: Commit**

```bash
git add packages/server/src/api/rest/ packages/server/src/__tests__/api-rest.test.ts
git commit -m "feat(server): add REST API routes for agents and sessions"
```

---

## Task 8: @matrix/server — WebSocket Handler

**Files:**
- Create: `packages/server/src/api/ws/index.ts`
- Create: `packages/server/src/api/ws/connection-manager.ts`

**Step 1: Implement ConnectionManager**

File: `packages/server/src/api/ws/connection-manager.ts`

```typescript
import type { ServerWebSocket } from "hono/ws";
import type { ServerMessage } from "@matrix/protocol";

interface ClientConnection {
  ws: ServerWebSocket;
  lastEventId: number;
  subscribedSessions: Set<string>;
}

/**
 * Manages WebSocket connections from clients.
 * Handles message buffering for reconnection.
 */
export class ConnectionManager {
  private connections = new Map<string, ClientConnection>();
  private messageBuffers = new Map<string, Array<{ eventId: number; message: ServerMessage }>>();
  private eventCounter = 0;
  private static readonly MAX_BUFFER_SIZE = 500;

  addConnection(connectionId: string, ws: ServerWebSocket): void {
    this.connections.set(connectionId, {
      ws,
      lastEventId: 0,
      subscribedSessions: new Set(),
    });
  }

  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  subscribeToSession(connectionId: string, sessionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.subscribedSessions.add(sessionId);
    }
  }

  /** Broadcast a message to all clients subscribed to a session */
  broadcastToSession(sessionId: string, message: ServerMessage): void {
    const eventId = ++this.eventCounter;
    const enrichedMessage = { ...message, eventId: String(eventId) };

    // Buffer the message
    if (!this.messageBuffers.has(sessionId)) {
      this.messageBuffers.set(sessionId, []);
    }
    const buffer = this.messageBuffers.get(sessionId)!;
    buffer.push({ eventId, message: enrichedMessage });
    if (buffer.length > ConnectionManager.MAX_BUFFER_SIZE) {
      buffer.shift();
    }

    // Send to all subscribed connections
    for (const [, conn] of this.connections) {
      if (conn.subscribedSessions.has(sessionId)) {
        conn.ws.send(JSON.stringify(enrichedMessage));
        conn.lastEventId = eventId;
      }
    }
  }

  /** Replay missed messages for a reconnecting client */
  replayMissed(connectionId: string, sessionId: string, lastEventId: number): void {
    const conn = this.connections.get(connectionId);
    const buffer = this.messageBuffers.get(sessionId);
    if (!conn || !buffer) return;

    for (const entry of buffer) {
      if (entry.eventId > lastEventId) {
        conn.ws.send(JSON.stringify(entry.message));
      }
    }
  }
}
```

**Step 2: Implement WebSocket handler**

File: `packages/server/src/api/ws/index.ts`

```typescript
import { createNodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";
import type { ClientMessage, PermissionOutcome } from "@matrix/protocol";
import type { ConnectionManager } from "./connection-manager.js";
import { nanoid } from "nanoid";
import { validateToken } from "../../auth/token.js";

export interface WsHandlerDeps {
  connectionManager: ConnectionManager;
  serverToken: string;
  onPrompt: (sessionId: string, prompt: Array<{ type: string; text: string }>) => void;
  onPermissionResponse: (sessionId: string, toolCallId: string, outcome: PermissionOutcome) => void;
}

export function setupWebSocket(app: Hono, deps: WsHandlerDeps) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: app as any });

  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      const connectionId = nanoid();

      return {
        onOpen(_event, ws) {
          // Auth check via query param (WebSocket can't use headers easily)
          const token = new URL(c.req.url, "http://localhost").searchParams.get("token");
          if (!token || !validateToken(token, deps.serverToken)) {
            ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "Invalid token" }));
            ws.close(4001, "Unauthorized");
            return;
          }
          deps.connectionManager.addConnection(connectionId, ws as any);
        },

        onMessage(event, ws) {
          try {
            const msg: ClientMessage = JSON.parse(event.data as string);

            switch (msg.type) {
              case "session:prompt":
                deps.connectionManager.subscribeToSession(connectionId, msg.sessionId);
                deps.onPrompt(msg.sessionId, msg.prompt);
                break;

              case "session:permission_response":
                deps.onPermissionResponse(msg.sessionId, msg.toolCallId, msg.outcome);
                break;

              case "ping":
                ws.send(JSON.stringify({ type: "pong" }));
                break;
            }
          } catch (err) {
            ws.send(JSON.stringify({ type: "error", code: "parse_error", message: "Invalid message" }));
          }
        },

        onClose() {
          deps.connectionManager.removeConnection(connectionId);
        },
      };
    }),
  );

  return { injectWebSocket };
}
```

**Step 3: Commit**

```bash
git add packages/server/src/api/ws/
git commit -m "feat(server): add WebSocket handler with connection management and replay"
```

---

## Task 9: @matrix/server — Main Entry Point

**Files:**
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/config.ts`

**Step 1: Create server config**

File: `packages/server/src/config.ts`

```typescript
import type { AgentConfig } from "@matrix/protocol";

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  agents: AgentConfig[];
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.MATRIX_PORT || "8080", 10),
    host: process.env.MATRIX_HOST || "0.0.0.0",
    dbPath: process.env.MATRIX_DB_PATH || "./matrix.db",
    agents: [
      {
        id: "claude-code-acp",
        name: "Claude Code",
        command: process.env.CLAUDE_CODE_ACP_PATH || "claude-code-acp",
        args: [],
      },
    ],
  };
}
```

**Step 2: Create main entry**

File: `packages/server/src/index.ts`

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { generateToken } from "./auth/token.js";
import { authMiddleware } from "./auth/middleware.js";
import { AgentManager } from "./agent-manager/index.js";
import { Store } from "./store/index.js";
import { AcpBridge } from "./acp-bridge/index.js";
import { createRestRoutes } from "./api/rest/index.js";
import { setupWebSocket } from "./api/ws/index.js";
import { ConnectionManager } from "./api/ws/connection-manager.js";
import type { CreateSessionRequest } from "@matrix/protocol";
import { nanoid } from "nanoid";

const config = loadConfig();
const serverToken = generateToken();
const agentManager = new AgentManager();
const store = new Store(config.dbPath);
const connectionManager = new ConnectionManager();

// Register configured agents
for (const agent of config.agents) {
  agentManager.register(agent);
}

// Track active bridges per session
const bridges = new Map<string, AcpBridge>();

const app = new Hono();

// CORS for web client
app.use("/*", cors());

// Auth middleware for REST (WebSocket handles auth separately)
app.use("/agents/*", authMiddleware(serverToken));
app.use("/sessions/*", authMiddleware(serverToken));

// REST routes
app.route("/", createRestRoutes(agentManager, store));

// Session creation (needs special handling — spawns agent)
app.post("/sessions", async (c) => {
  const body = await c.req.json<CreateSessionRequest>();

  const handle = agentManager.spawn(body.agentId, body.cwd);
  const sessionId = `sess_${nanoid()}`;

  const bridge = new AcpBridge(handle.process, {
    onSessionUpdate(sid, update) {
      connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update,
        eventId: "",
      });
      // Store text messages in history
      if (update.sessionUpdate === "agent_message_chunk") {
        store.appendHistory(sessionId, "agent", update.content.text);
      }
    },
    onPermissionRequest(sid, request) {
      connectionManager.broadcastToSession(sessionId, {
        type: "session:update",
        sessionId,
        update: {
          sessionUpdate: "permission_request",
          toolCallId: (request.params as any).toolCall.toolCallId,
          toolCall: (request.params as any).toolCall,
          options: (request.params as any).options,
        },
        eventId: "",
      });
    },
    onError(error) {
      console.error(`[session ${sessionId}] Agent error:`, error);
      connectionManager.broadcastToSession(sessionId, {
        type: "error",
        code: "agent_error",
        message: error.message,
      });
    },
    onClose() {
      console.log(`[session ${sessionId}] Agent process closed`);
      connectionManager.broadcastToSession(sessionId, {
        type: "session:closed",
        sessionId,
      });
      bridges.delete(sessionId);
    },
  });

  bridges.set(sessionId, bridge);

  // Initialize ACP connection
  const initResult = await bridge.initialize({ name: "matrix-server", version: "0.1.0" });
  const sessionResult = await bridge.createSession(body.cwd) as any;

  store.createSession(sessionId, body.agentId, body.cwd);

  return c.json({
    sessionId,
    modes: sessionResult.modes || { currentModeId: "code", availableModes: [] },
  });
});

// WebSocket setup
const { injectWebSocket } = setupWebSocket(app as any, {
  connectionManager,
  serverToken,
  onPrompt(sessionId, prompt) {
    const bridge = bridges.get(sessionId);
    if (bridge) {
      bridge.sendPrompt(sessionId, prompt);
    }
  },
  onPermissionResponse(sessionId, toolCallId, outcome) {
    const bridge = bridges.get(sessionId);
    if (bridge) {
      // Find the pending permission request ID from the bridge
      bridge.respondPermission(toolCallId, outcome);
    }
  },
});

// Start server
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

injectWebSocket(server);

console.log(`\n  Matrix Server running on http://${config.host}:${config.port}`);
console.log(`\n  Auth token: ${serverToken}`);
console.log(`\n  Registered agents: ${config.agents.map((a) => a.name).join(", ")}\n`);
```

**Step 3: Verify build**

Run: `cd packages/server && pnpm build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/config.ts
git commit -m "feat(server): add main entry point wiring all modules together"
```

---

## Task 10: @matrix/sdk — Transport Layer

**Files:**
- Create: `packages/sdk/src/transport/websocket.ts`
- Create: `packages/sdk/src/transport/sse.ts`
- Create: `packages/sdk/src/transport/polling.ts`
- Create: `packages/sdk/src/transport/index.ts`
- Test: `packages/sdk/src/__tests__/transport.test.ts`

**Step 1: Write the failing test**

File: `packages/sdk/src/__tests__/transport.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { createTransport, type Transport } from "../transport/index.js";

describe("transport", () => {
  it("creates a websocket transport by default", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test-token",
      mode: "websocket",
    });
    expect(transport).toBeDefined();
    expect(transport.type).toBe("websocket");
  });

  it("creates an sse transport", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test-token",
      mode: "sse",
    });
    expect(transport.type).toBe("sse");
  });

  it("creates a polling transport", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test-token",
      mode: "polling",
    });
    expect(transport.type).toBe("polling");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/sdk && pnpm test`
Expected: FAIL — module not found

**Step 3: Define Transport interface**

File: `packages/sdk/src/transport/index.ts`

```typescript
import type { TransportMode, ServerMessage, ClientMessage, ConnectionStatus } from "@matrix/protocol";

export interface TransportConfig {
  serverUrl: string;
  token: string;
  mode: TransportMode;
}

export type TransportEventHandler = {
  onMessage: (message: ServerMessage) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onError: (error: Error) => void;
};

export interface Transport {
  type: TransportMode;
  connect(handlers: TransportEventHandler): void;
  send(message: ClientMessage): void;
  disconnect(): void;
}

export function createTransport(config: TransportConfig): Transport {
  switch (config.mode) {
    case "websocket":
      return new WebSocketTransport(config);
    case "sse":
      return new SseTransport(config);
    case "polling":
      return new PollingTransport(config);
    case "auto":
      // Try WebSocket first, fallback handled internally
      return new WebSocketTransport(config);
  }
}

// Inline implementations to keep things simple initially

class WebSocketTransport implements Transport {
  type = "websocket" as const;
  private ws: WebSocket | null = null;
  private handlers: TransportEventHandler | null = null;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 30000;
  private lastEventId = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private config: TransportConfig) {}

  connect(handlers: TransportEventHandler): void {
    this.handlers = handlers;
    this.doConnect();
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private doConnect(): void {
    this.handlers?.onStatusChange(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const wsUrl = this.config.serverUrl.replace(/^http/, "ws") + `/ws?token=${this.config.token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.handlers?.onStatusChange("connected");
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.eventId) {
          this.lastEventId = parseInt(msg.eventId, 10);
        }
        if (msg.type === "pong") return;
        this.handlers?.onMessage(msg);
      } catch (err) {
        this.handlers?.onError(new Error("Failed to parse server message"));
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.handlers?.onError(new Error("WebSocket error"));
    };
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt - 1), this.maxReconnectDelay);
    this.handlers?.onStatusChange("reconnecting");
    setTimeout(() => this.doConnect(), delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: "ping" });
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

class SseTransport implements Transport {
  type = "sse" as const;
  private eventSource: EventSource | null = null;
  private handlers: TransportEventHandler | null = null;

  constructor(private config: TransportConfig) {}

  connect(handlers: TransportEventHandler): void {
    this.handlers = handlers;
    handlers.onStatusChange("connecting");

    const url = `${this.config.serverUrl}/sse?token=${this.config.token}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      handlers.onStatusChange("degraded"); // SSE = degraded mode
    };

    this.eventSource.onmessage = (event) => {
      try {
        handlers.onMessage(JSON.parse(event.data));
      } catch {}
    };

    this.eventSource.onerror = () => {
      handlers.onStatusChange("reconnecting");
    };
  }

  send(message: ClientMessage): void {
    // SSE is read-only, use HTTP POST for upstream
    fetch(`${this.config.serverUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify(message),
    }).catch(() => {});
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }
}

class PollingTransport implements Transport {
  type = "polling" as const;
  private handlers: TransportEventHandler | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastEventId = 0;

  constructor(private config: TransportConfig) {}

  connect(handlers: TransportEventHandler): void {
    this.handlers = handlers;
    handlers.onStatusChange("degraded");

    this.pollInterval = setInterval(() => this.poll(), 2000);
  }

  send(message: ClientMessage): void {
    fetch(`${this.config.serverUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify(message),
    }).catch(() => {});
  }

  disconnect(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(
        `${this.config.serverUrl}/poll?lastEventId=${this.lastEventId}`,
        { headers: { Authorization: `Bearer ${this.config.token}` } },
      );
      const messages = await res.json();
      for (const msg of messages) {
        if (msg.eventId) this.lastEventId = parseInt(msg.eventId, 10);
        this.handlers?.onMessage(msg);
      }
    } catch {}
  }
}
```

**Step 4: Run tests**

Run: `cd packages/sdk && pnpm test`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add packages/sdk/src/transport/
git commit -m "feat(sdk): add transport layer with WebSocket, SSE, and polling fallback"
```

---

## Task 11: @matrix/sdk — MatrixClient and MatrixSession

**Files:**
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/session.ts`
- Create: `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/__tests__/client.test.ts`

**Step 1: Write the failing test**

File: `packages/sdk/src/__tests__/client.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { MatrixClient } from "../client.js";

describe("MatrixClient", () => {
  it("constructs with config", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    expect(client).toBeDefined();
  });

  it("defaults transport to auto", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    expect(client.transportMode).toBe("auto");
  });

  it("builds correct REST URL", () => {
    const client = new MatrixClient({
      serverUrl: "http://localhost:8080",
      token: "test",
    });
    // Test the internal fetch helper
    expect(client.serverUrl).toBe("http://localhost:8080");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/sdk && pnpm test`
Expected: FAIL — module not found

**Step 3: Implement MatrixSession**

File: `packages/sdk/src/session.ts`

```typescript
import type {
  SessionId,
  SessionUpdate,
  PromptContent,
  PermissionOutcome,
  StopReason,
} from "@matrix/protocol";
import type { Transport } from "./transport/index.js";

export interface PromptCallbacks {
  onMessage?: (chunk: { type: "text"; text: string }) => void;
  onToolCall?: (toolCall: Extract<SessionUpdate, { sessionUpdate: "tool_call" }>) => void;
  onToolCallUpdate?: (update: Extract<SessionUpdate, { sessionUpdate: "tool_call_update" }>) => void;
  onPermissionRequest?: (request: Extract<SessionUpdate, { sessionUpdate: "permission_request" }>) => void;
  onPlan?: (plan: Extract<SessionUpdate, { sessionUpdate: "plan" }>) => void;
  onComplete?: (result: { stopReason: StopReason }) => void;
}

export class MatrixSession {
  private callbacks: PromptCallbacks | null = null;

  constructor(
    public readonly sessionId: SessionId,
    private transport: Transport,
    private restFetch: (path: string, init?: RequestInit) => Promise<Response>,
  ) {}

  /** Send a text prompt */
  prompt(text: string, callbacks: PromptCallbacks): void {
    this.callbacks = callbacks;
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  /** Send a prompt with rich content */
  promptWithContent(content: PromptContent[], callbacks: PromptCallbacks): void {
    this.callbacks = callbacks;
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: content,
    });
  }

  /** Approve a tool call / permission request */
  approveToolCall(toolCallId: string, optionId = "allow-once"): void {
    this.transport.send({
      type: "session:permission_response",
      sessionId: this.sessionId,
      toolCallId,
      outcome: { outcome: "selected", optionId },
    });
  }

  /** Reject a tool call / permission request */
  rejectToolCall(toolCallId: string, optionId = "reject-once"): void {
    this.transport.send({
      type: "session:permission_response",
      sessionId: this.sessionId,
      toolCallId,
      outcome: { outcome: "selected", optionId },
    });
  }

  /** Get session history */
  async getHistory() {
    const res = await this.restFetch(`/sessions/${this.sessionId}/history`);
    return res.json();
  }

  /** Close this session */
  async close(): Promise<void> {
    await this.restFetch(`/sessions/${this.sessionId}`, { method: "DELETE" });
  }

  /** Called by MatrixClient when a session update arrives */
  handleUpdate(update: SessionUpdate): void {
    if (!this.callbacks) return;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.callbacks.onMessage?.(update.content);
        break;
      case "tool_call":
        this.callbacks.onToolCall?.(update);
        break;
      case "tool_call_update":
        this.callbacks.onToolCallUpdate?.(update);
        break;
      case "permission_request":
        this.callbacks.onPermissionRequest?.(update);
        break;
      case "plan":
        this.callbacks.onPlan?.(update);
        break;
      case "completed":
        this.callbacks.onComplete?.({ stopReason: update.stopReason });
        this.callbacks = null;
        break;
    }
  }
}
```

**Step 4: Implement MatrixClient**

File: `packages/sdk/src/client.ts`

```typescript
import type {
  TransportMode,
  ConnectionStatus,
  ServerMessage,
  AgentListItem,
  CreateSessionRequest,
  CreateSessionResponse,
  SessionInfo,
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

  /** Connect to the server */
  connect(): void {
    this.transport = createTransport({
      serverUrl: this.serverUrl,
      token: this.token,
      mode: this.transportMode,
    });

    this.transport.connect({
      onMessage: (msg) => this.handleServerMessage(msg),
      onStatusChange: (status) => {
        for (const listener of this.statusListeners) {
          listener(status);
        }
      },
      onError: (err) => {
        console.error("[MatrixClient] Transport error:", err);
      },
    });
  }

  /** Disconnect from the server */
  disconnect(): void {
    this.transport?.disconnect();
    this.transport = null;
  }

  /** Listen for connection status changes */
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  /** List available agents */
  async getAgents(): Promise<AgentListItem[]> {
    const res = await this.fetch("/agents");
    return res.json();
  }

  /** List active sessions */
  async getSessions(): Promise<SessionInfo[]> {
    const res = await this.fetch("/sessions");
    return res.json();
  }

  /** Create a new session */
  async createSession(request: CreateSessionRequest): Promise<MatrixSession> {
    const res = await this.fetch("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data: CreateSessionResponse = await res.json();

    const session = new MatrixSession(
      data.sessionId,
      this.transport!,
      (path, init) => this.fetch(path, init),
    );
    this.sessions.set(data.sessionId, session);

    // Auto-subscribe to session updates via transport
    this.transport?.send({
      type: "session:prompt",
      sessionId: data.sessionId,
      prompt: [],
    });

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
      case "session:closed": {
        this.sessions.delete(msg.sessionId);
        break;
      }
      case "error": {
        console.error("[MatrixClient] Server error:", msg.message);
        break;
      }
    }
  }
}
```

**Step 5: Create barrel export**

File: `packages/sdk/src/index.ts`

```typescript
export { MatrixClient, type MatrixClientConfig } from "./client.js";
export { MatrixSession, type PromptCallbacks } from "./session.js";
export { createTransport, type Transport, type TransportConfig } from "./transport/index.js";
```

**Step 6: Run tests**

Run: `cd packages/sdk && pnpm test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add packages/sdk/src/
git commit -m "feat(sdk): add MatrixClient and MatrixSession with transport abstraction"
```

---

## Task 12: @matrix/client — Tauri v2 + React Scaffold

> **Note:** This task requires Tauri CLI to be installed: `cargo install tauri-cli@^2.0`. If Rust/Cargo is not available, skip to Task 13 and scaffold the React frontend only as a web app first.

**Files:**
- Create: `packages/client/package.json`
- Create: `packages/client/tsconfig.json`
- Create: `packages/client/src-tauri/tauri.conf.json`
- Create: `packages/client/src-tauri/Cargo.toml`
- Create: `packages/client/src-tauri/src/lib.rs`
- Create: `packages/client/index.html`
- Create: `packages/client/vite.config.ts`
- Create: `packages/client/src/main.tsx`
- Create: `packages/client/src/App.tsx`

**Step 1: Create package.json**

```json
{
  "name": "@matrix/client",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@matrix/sdk": "workspace:*",
    "@matrix/protocol": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@tauri-apps/cli": "^2.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true
  },
  "include": ["src"]
}
```

**Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
```

**Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Matrix</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 5: Create src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 6: Create src/App.tsx (minimal shell)**

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SessionPage } from "./pages/SessionPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ConnectPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/session/:sessionId" element={<SessionPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 7: Create placeholder pages**

File: `packages/client/src/pages/ConnectPage.tsx`

```tsx
export function ConnectPage() {
  return <div>Connect Page — TODO</div>;
}
```

File: `packages/client/src/pages/DashboardPage.tsx`

```tsx
export function DashboardPage() {
  return <div>Dashboard — TODO</div>;
}
```

File: `packages/client/src/pages/SessionPage.tsx`

```tsx
export function SessionPage() {
  return <div>Session Page — TODO</div>;
}
```

**Step 8: Create Tauri config**

File: `packages/client/src-tauri/tauri.conf.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-config-schema/schema.json",
  "productName": "Matrix",
  "version": "0.1.0",
  "identifier": "com.matrix.client",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
  "app": {
    "windows": [
      {
        "title": "Matrix",
        "width": 1024,
        "height": 768,
        "minWidth": 400,
        "minHeight": 600
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": []
  }
}
```

File: `packages/client/src-tauri/Cargo.toml`

```toml
[package]
name = "matrix-client"
version = "0.1.0"
edition = "2021"

[lib]
name = "matrix_client_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[dependencies]
tauri = { version = "2", features = [] }
tauri-build = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

File: `packages/client/src-tauri/src/lib.rs`

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

File: `packages/client/src-tauri/build.rs`

```rust
fn main() {
    tauri_build::build()
}
```

**Step 9: Install and verify**

Run: `pnpm install && cd packages/client && pnpm dev`
Expected: Vite dev server starts on port 5173, shows Connect Page

**Step 10: Commit**

```bash
git add packages/client/
git commit -m "feat(client): scaffold Tauri v2 + React app with routing"
```

---

## Task 13: @matrix/client — Connect Page

**Files:**
- Create: `packages/client/src/hooks/useMatrixClient.ts`
- Modify: `packages/client/src/pages/ConnectPage.tsx`
- Create: `packages/client/src/styles/connect.css`

**Step 1: Create MatrixClient hook**

File: `packages/client/src/hooks/useMatrixClient.ts`

```tsx
import { createContext, useContext, useState, useCallback } from "react";
import { MatrixClient, type MatrixClientConfig } from "@matrix/sdk";
import type { ConnectionStatus } from "@matrix/protocol";

interface MatrixClientState {
  client: MatrixClient | null;
  status: ConnectionStatus;
  connect: (config: MatrixClientConfig) => void;
  disconnect: () => void;
}

export const MatrixClientContext = createContext<MatrixClientState>({
  client: null,
  status: "offline",
  connect: () => {},
  disconnect: () => {},
});

export function useMatrixClient() {
  return useContext(MatrixClientContext);
}

export function useMatrixClientProvider(): MatrixClientState {
  const [client, setClient] = useState<MatrixClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("offline");

  const connect = useCallback((config: MatrixClientConfig) => {
    const newClient = new MatrixClient(config);
    newClient.onStatusChange(setStatus);
    newClient.connect();
    setClient(newClient);

    // Save connection for auto-reconnect
    localStorage.setItem("matrix:lastConnection", JSON.stringify({
      serverUrl: config.serverUrl,
      token: config.token,
    }));
  }, []);

  const disconnect = useCallback(() => {
    client?.disconnect();
    setClient(null);
    setStatus("offline");
  }, [client]);

  return { client, status, connect, disconnect };
}
```

**Step 2: Implement Connect Page**

File: `packages/client/src/pages/ConnectPage.tsx`

```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMatrixClient } from "../hooks/useMatrixClient";

export function ConnectPage() {
  const navigate = useNavigate();
  const { connect, status } = useMatrixClient();
  const [serverUrl, setServerUrl] = useState("http://localhost:8080");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  // Auto-fill from last connection
  useEffect(() => {
    const saved = localStorage.getItem("matrix:lastConnection");
    if (saved) {
      const { serverUrl: url, token: tok } = JSON.parse(saved);
      setServerUrl(url);
      setToken(tok);
    }
  }, []);

  // Navigate on successful connection
  useEffect(() => {
    if (status === "connected") {
      navigate("/dashboard");
    }
  }, [status, navigate]);

  const handleConnect = () => {
    if (!serverUrl || !token) {
      setError("Server URL and token are required");
      return;
    }
    setError("");
    connect({ serverUrl, token });
  };

  return (
    <div className="connect-page">
      <h1>Matrix</h1>
      <p>Connect to your ACP Server</p>

      <div className="connect-form">
        <label>
          Server URL
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:8080"
          />
        </label>

        <label>
          Token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your server token"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button onClick={handleConnect} disabled={status === "connecting"}>
          {status === "connecting" ? "Connecting..." : "Connect"}
        </button>

        <p className="status">Status: {status}</p>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add packages/client/src/
git commit -m "feat(client): implement Connect Page with auto-reconnect"
```

---

## Task 14: @matrix/client — Dashboard Page

**Files:**
- Modify: `packages/client/src/pages/DashboardPage.tsx`

**Step 1: Implement Dashboard**

File: `packages/client/src/pages/DashboardPage.tsx`

```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMatrixClient } from "../hooks/useMatrixClient";
import type { AgentListItem, SessionInfo } from "@matrix/protocol";

export function DashboardPage() {
  const navigate = useNavigate();
  const { client, status } = useMatrixClient();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    if (!client) {
      navigate("/");
      return;
    }
    client.getAgents().then(setAgents);
    client.getSessions().then(setSessions);
  }, [client, navigate]);

  const handleCreateSession = async () => {
    if (!client || !selectedAgent || !cwd) return;
    setCreating(true);
    try {
      const session = await client.createSession({ agentId: selectedAgent, cwd });
      navigate(`/session/${session.sessionId}`);
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="dashboard">
      <header>
        <h1>Matrix Dashboard</h1>
        <span className={`status-badge ${status}`}>{status}</span>
      </header>

      <section>
        <h2>Agents</h2>
        <ul>
          {agents.map((agent) => (
            <li key={agent.id}>
              {agent.name} ({agent.command}) — {agent.available ? "Available" : "Unavailable"}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>New Session</h2>
        <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
          <option value="">Select an agent...</option>
          {agents.filter((a) => a.available).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="Working directory (e.g. /home/user/project)"
        />
        <button onClick={handleCreateSession} disabled={creating || !selectedAgent || !cwd}>
          {creating ? "Creating..." : "Create Session"}
        </button>
      </section>

      <section>
        <h2>Active Sessions</h2>
        {sessions.length === 0 ? (
          <p>No active sessions</p>
        ) : (
          <ul>
            {sessions.filter((s) => s.status === "active").map((s) => (
              <li key={s.sessionId} onClick={() => navigate(`/session/${s.sessionId}`)}>
                {s.agentId} — {s.cwd} — {s.createdAt}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/client/src/pages/DashboardPage.tsx
git commit -m "feat(client): implement Dashboard with agent list and session management"
```

---

## Task 15: @matrix/client — Session Page (Core UI)

**Files:**
- Modify: `packages/client/src/pages/SessionPage.tsx`
- Create: `packages/client/src/components/MessageList.tsx`
- Create: `packages/client/src/components/ToolCallCard.tsx`
- Create: `packages/client/src/components/PermissionCard.tsx`
- Create: `packages/client/src/components/PlanView.tsx`
- Create: `packages/client/src/components/PromptInput.tsx`

**Step 1: Create MessageList component**

File: `packages/client/src/components/MessageList.tsx`

```tsx
import type { SessionUpdate } from "@matrix/protocol";
import { ToolCallCard } from "./ToolCallCard";
import { PermissionCard } from "./PermissionCard";
import { PlanView } from "./PlanView";

export interface SessionEvent {
  id: string;
  type: "message" | "tool_call" | "tool_call_update" | "permission_request" | "plan";
  data: SessionUpdate;
  timestamp: number;
}

interface Props {
  events: SessionEvent[];
  onApprove: (toolCallId: string, optionId: string) => void;
  onReject: (toolCallId: string, optionId: string) => void;
}

export function MessageList({ events, onApprove, onReject }: Props) {
  return (
    <div className="message-list">
      {events.map((event) => {
        switch (event.data.sessionUpdate) {
          case "agent_message_chunk":
            return (
              <div key={event.id} className="message agent-message">
                {event.data.content.text}
              </div>
            );
          case "tool_call":
            return <ToolCallCard key={event.id} toolCall={event.data} />;
          case "tool_call_update":
            return <ToolCallCard key={event.id} toolCall={event.data} />;
          case "permission_request":
            return (
              <PermissionCard
                key={event.id}
                request={event.data}
                onApprove={onApprove}
                onReject={onReject}
              />
            );
          case "plan":
            return <PlanView key={event.id} plan={event.data} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
```

**Step 2: Create ToolCallCard**

File: `packages/client/src/components/ToolCallCard.tsx`

```tsx
interface Props {
  toolCall: {
    toolCallId: string;
    title?: string;
    kind?: string;
    status: string;
    locations?: Array<{ path: string }>;
    content?: Array<{ type: string; text?: string; path?: string; oldText?: string; newText?: string }>;
  };
}

export function ToolCallCard({ toolCall }: Props) {
  return (
    <div className={`tool-call-card status-${toolCall.status}`}>
      <div className="tool-call-header">
        <span className="tool-kind">{toolCall.kind || "tool"}</span>
        <span className="tool-title">{toolCall.title || toolCall.toolCallId}</span>
        <span className="tool-status">{toolCall.status}</span>
      </div>
      {toolCall.locations?.map((loc, i) => (
        <div key={i} className="tool-location">{loc.path}</div>
      ))}
      {toolCall.content?.map((c, i) => (
        <div key={i} className="tool-content">
          {c.type === "diff" ? (
            <pre className="diff">
              {`--- ${c.path}\n+++ ${c.path}\n- ${c.oldText}\n+ ${c.newText}`}
            </pre>
          ) : (
            <span>{c.text}</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Create PermissionCard**

File: `packages/client/src/components/PermissionCard.tsx`

```tsx
import type { PermissionOption } from "@matrix/protocol";

interface Props {
  request: {
    toolCallId: string;
    toolCall: { title: string; kind: string; content?: Array<{ type: string; text?: string }> };
    options: PermissionOption[];
  };
  onApprove: (toolCallId: string, optionId: string) => void;
  onReject: (toolCallId: string, optionId: string) => void;
}

export function PermissionCard({ request, onApprove, onReject }: Props) {
  const approveOption = request.options.find(
    (o) => o.kind === "allow_once" || o.kind === "allow_always"
  );
  const rejectOption = request.options.find(
    (o) => o.kind === "reject_once" || o.kind === "reject_always"
  );

  return (
    <div className="permission-card">
      <div className="permission-header">
        <span className="permission-kind">{request.toolCall.kind}</span>
        <span className="permission-title">{request.toolCall.title}</span>
      </div>
      {request.toolCall.content?.map((c, i) => (
        <div key={i} className="permission-content">{c.text}</div>
      ))}
      <div className="permission-actions">
        {approveOption && (
          <button
            className="btn-approve"
            onClick={() => onApprove(request.toolCallId, approveOption.optionId)}
          >
            {approveOption.name}
          </button>
        )}
        {rejectOption && (
          <button
            className="btn-reject"
            onClick={() => onReject(request.toolCallId, rejectOption.optionId)}
          >
            {rejectOption.name}
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Create PlanView**

File: `packages/client/src/components/PlanView.tsx`

```tsx
import type { PlanEntry } from "@matrix/protocol";

interface Props {
  plan: { entries: PlanEntry[] };
}

const statusIcon: Record<string, string> = {
  completed: "[done]",
  in_progress: "[...]",
  pending: "[ ]",
};

export function PlanView({ plan }: Props) {
  return (
    <div className="plan-view">
      <div className="plan-header">Plan</div>
      <ul>
        {plan.entries.map((entry, i) => (
          <li key={i} className={`plan-entry plan-${entry.status}`}>
            <span className="plan-status">{statusIcon[entry.status] || "[ ]"}</span>
            <span className="plan-content">{entry.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**Step 5: Create PromptInput**

File: `packages/client/src/components/PromptInput.tsx`

```tsx
import { useState, type KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function PromptInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="prompt-input">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter message..."
        disabled={disabled}
        rows={3}
      />
      <button onClick={handleSend} disabled={disabled || !text.trim()}>
        Send
      </button>
    </div>
  );
}
```

**Step 6: Implement SessionPage**

File: `packages/client/src/pages/SessionPage.tsx`

```tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMatrixClient } from "../hooks/useMatrixClient";
import { MessageList, type SessionEvent } from "../components/MessageList";
import { PromptInput } from "../components/PromptInput";
import type { MatrixSession } from "@matrix/sdk";
import { nanoid } from "nanoid";

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { client } = useMatrixClient();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [session, setSession] = useState<MatrixSession | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!client || !sessionId) {
      navigate("/");
    }
  }, [client, sessionId, navigate]);

  const addEvent = useCallback((type: SessionEvent["type"], data: any) => {
    setEvents((prev) => [...prev, { id: nanoid(), type, data, timestamp: Date.now() }]);
  }, []);

  const handleSend = useCallback((text: string) => {
    if (!session) return;
    setIsProcessing(true);
    addEvent("message", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `> ${text}` } });

    session.prompt(text, {
      onMessage: (chunk) => addEvent("message", { sessionUpdate: "agent_message_chunk", content: chunk }),
      onToolCall: (tc) => addEvent("tool_call", tc),
      onToolCallUpdate: (tc) => addEvent("tool_call_update", tc),
      onPermissionRequest: (req) => addEvent("permission_request", req),
      onPlan: (plan) => addEvent("plan", plan),
      onComplete: () => setIsProcessing(false),
    });
  }, [session, addEvent]);

  const handleApprove = useCallback((toolCallId: string, optionId: string) => {
    session?.approveToolCall(toolCallId, optionId);
  }, [session]);

  const handleReject = useCallback((toolCallId: string, optionId: string) => {
    session?.rejectToolCall(toolCallId, optionId);
  }, [session]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="session-page">
      <header>
        <button onClick={() => navigate("/dashboard")}>Back</button>
        <span>Session: {sessionId}</span>
      </header>

      <MessageList events={events} onApprove={handleApprove} onReject={handleReject} />
      <div ref={messagesEndRef} />

      <PromptInput onSend={handleSend} disabled={isProcessing} />
    </div>
  );
}
```

**Step 7: Commit**

```bash
git add packages/client/src/
git commit -m "feat(client): implement Session Page with message stream, tool calls, and permissions"
```

---

## Task 16: Verify Full Build

**Step 1: Build all packages in order**

Run: `pnpm build`
Expected: All packages compile successfully

**Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass

**Step 3: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: resolve build issues across all packages"
```

---

## Summary

| Task | Package | Description |
|------|---------|-------------|
| 1 | root | Monorepo scaffold (pnpm + TypeScript) |
| 2 | protocol | Core ACP type definitions |
| 3 | server | Token auth module |
| 4 | server | Agent manager (spawn/manage processes) |
| 5 | server | ACP bridge (stdio ↔ JSON-RPC) |
| 6 | server | SQLite store (sessions + history) |
| 7 | server | REST API routes |
| 8 | server | WebSocket handler + connection manager |
| 9 | server | Main entry point |
| 10 | sdk | Transport layer (WS/SSE/Polling) |
| 11 | sdk | MatrixClient + MatrixSession |
| 12 | client | Tauri v2 + React scaffold |
| 13 | client | Connect Page |
| 14 | client | Dashboard Page |
| 15 | client | Session Page (core UI) |
| 16 | all | Full build verification |

**Dependency order:** protocol → server + sdk (parallel) → client
