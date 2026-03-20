export interface BridgeClient {
  baseUrl: string;
  token: string;

  health(): Promise<{
    ok: boolean;
    clientCount: number;
    clients: Array<{ clientId: string; platform: string; label: string }>;
  }>;

  eval(script: string): Promise<unknown>;

  event(name: string, payload?: unknown): Promise<void>;

  reset(scopes?: string[]): Promise<void>;

  wait(condition: {
    kind: string;
    script?: string;
    path?: string;
    equals?: unknown;
  }, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<unknown>;

  mockFileDialog(path: string): Promise<void>;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 200;

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
  const jsonBody = body !== undefined ? JSON.stringify(body) : undefined;
  if (jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const init: RequestInit = { method, headers, body: jsonBody };
    const res = await fetch(url, init);

    // 408 = server read timeout (transient) — retry
    if (res.status === 408 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bridge ${method} ${path} returned ${res.status}: ${text}`);
    }

    const text = await res.text();
    if (!text) return undefined;
    return JSON.parse(text);
  }

  throw new Error(`Bridge ${method} ${path} failed after ${MAX_RETRIES} retries`);
}

/**
 * Create a bridge client that talks to the matrix server's /bridge/* endpoints.
 * Reads MATRIX_PORT and MATRIX_TOKEN from environment variables.
 */
export function createBridgeClient(): BridgeClient {
  const port = process.env.MATRIX_PORT;
  if (!port) throw new Error("MATRIX_PORT env var is required");
  const token = process.env.MATRIX_TOKEN;
  if (!token) throw new Error("MATRIX_TOKEN env var is required");

  const baseUrl = `http://127.0.0.1:${port}`;

  const client: BridgeClient = {
    baseUrl,
    token,

    async health() {
      return (await request(baseUrl, token, "GET", "/bridge/health")) as Awaited<
        ReturnType<BridgeClient["health"]>
      >;
    },

    async eval(script: string) {
      const res = (await request(baseUrl, token, "POST", "/bridge/eval", {
        script,
      })) as { ok: boolean; result: unknown; error: unknown };
      if (!res.ok) {
        throw new Error(
          `bridge/eval failed: ${typeof res.error === "string" ? res.error : JSON.stringify(res.error)}`,
        );
      }
      return res.result;
    },

    async event(name: string, payload?: unknown) {
      await request(baseUrl, token, "POST", "/bridge/event", {
        name,
        payload,
      });
    },

    async reset(scopes?: string[]) {
      await request(baseUrl, token, "POST", "/bridge/reset", {
        scopes: scopes ?? [],
      });
    },

    async wait(condition, opts) {
      // Map the old-style condition format to the new /bridge/wait endpoint
      const script = condition.script ?? `false`;
      const res = (await request(baseUrl, token, "POST", "/bridge/wait", {
        condition: script,
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
      // mock_file_dialog is now a Tauri command — call it via bridge eval which
      // invokes the Tauri command from the webview
      await client.eval(
        `window.__TAURI_INTERNALS__.invoke('mock_file_dialog', { path: ${JSON.stringify(path)} })`,
      );
    },
  };

  return client;
}
