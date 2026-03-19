import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface AutomationDiscovery {
  enabled: boolean;
  platform: string;
  baseUrl: string;
  token: string;
  pid: number;
}

export interface BridgeClient {
  baseUrl: string;
  token: string;

  health(): Promise<{
    ok: boolean;
    platform: string;
    appReady: boolean;
    webviewReady: boolean;
    sidecarReady: boolean;
  }>;

  state(): Promise<{
    window: Record<string, unknown>;
    webview: Record<string, unknown>;
    sidecar: Record<string, unknown>;
  }>;

  eval(script: string): Promise<unknown>;

  event(name: string, payload?: unknown): Promise<void>;

  invoke(action: string, args?: Record<string, unknown>): Promise<unknown>;

  reset(scopes?: string[]): Promise<void>;

  wait(condition: {
    kind: string;
    script?: string;
    path?: string;
    equals?: unknown;
  }, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<unknown>;

  mockFileDialog(path: string): Promise<void>;
}

const DISCOVERY_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Matrix",
  "dev",
  "automation.json",
);

async function loadDiscovery(): Promise<AutomationDiscovery> {
  const raw = await readFile(DISCOVERY_PATH, "utf-8");
  return JSON.parse(raw) as AutomationDiscovery;
}

async function request(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const init: RequestInit = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bridge ${method} ${path} returned ${res.status}: ${text}`);
  }

  const text = await res.text();
  if (!text) return undefined;
  return JSON.parse(text);
}

export async function createBridgeClient(): Promise<BridgeClient> {
  const discovery = await loadDiscovery();

  if (!discovery.enabled) {
    throw new Error("Automation bridge is not enabled");
  }

  const { baseUrl, token } = discovery;

  const client: BridgeClient = {
    baseUrl,
    token,

    async health() {
      return (await request(baseUrl, token, "GET", "/health")) as Awaited<
        ReturnType<BridgeClient["health"]>
      >;
    },

    async state() {
      return (await request(baseUrl, token, "GET", "/state")) as Awaited<
        ReturnType<BridgeClient["state"]>
      >;
    },

    async eval(script: string) {
      const res = (await request(baseUrl, token, "POST", "/webview/eval", {
        script,
      })) as { ok: boolean; result: unknown; error: unknown };
      if (!res.ok) {
        throw new Error(
          `webview/eval failed: ${typeof res.error === "string" ? res.error : JSON.stringify(res.error)}`,
        );
      }
      return res.result;
    },

    async event(name: string, payload?: unknown) {
      await request(baseUrl, token, "POST", "/webview/event", {
        name,
        payload,
      });
    },

    async invoke(action: string, args?: Record<string, unknown>) {
      const res = (await request(baseUrl, token, "POST", "/native/invoke", {
        action,
        args,
      })) as { ok: boolean; result: unknown; error: unknown };
      if (!res.ok) {
        throw new Error(
          `native/invoke ${action} failed: ${typeof res.error === "string" ? res.error : JSON.stringify(res.error)}`,
        );
      }
      return res.result;
    },

    async reset(scopes?: string[]) {
      await request(baseUrl, token, "POST", "/test/reset", {
        scopes: scopes ?? [],
      });
    },

    async wait(condition, opts) {
      const res = (await request(baseUrl, token, "POST", "/wait", {
        condition,
        timeoutMs: opts?.timeoutMs ?? 10_000,
        intervalMs: opts?.intervalMs ?? 200,
      })) as { ok: boolean; result: unknown; error: unknown };
      if (!res.ok) {
        throw new Error(
          `wait failed: ${typeof res.error === "string" ? res.error : JSON.stringify(res.error)}`,
        );
      }
      return res.result;
    },

    async mockFileDialog(path: string) {
      await request(baseUrl, token, "POST", "/test/mock-file-dialog", {
        path,
      });
    },
  };

  return client;
}
