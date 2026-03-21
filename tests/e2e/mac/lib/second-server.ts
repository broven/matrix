import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../../..");

export interface SecondServer {
  port: number;
  token: string;
  baseUrl: string;
  process: ChildProcess;
  dbPath: string;
  mockAgentId: string | null;

  /** Authenticated fetch against the second server */
  request(method: string, path: string, body?: unknown): Promise<unknown>;

  /** Shut down the server and clean up */
  teardown(): Promise<void>;
}

/**
 * Spawn a second Matrix server on a random port with a temporary database.
 * Returns server info and a cleanup function.
 */
export async function startSecondServer(): Promise<SecondServer> {
  const port = 19900 + Math.floor(Math.random() * 1000);
  const token = `test-token-${Date.now()}`;
  const tmpDir = await mkdtemp(join(tmpdir(), "matrix-second-server-"));
  const dbPath = join(tmpDir, "test.db");
  const baseUrl = `http://127.0.0.1:${port}`;

  const serverEntry = join(PROJECT_ROOT, "packages/server/src/index.ts");

  const child = spawn("bun", ["run", serverEntry, "--port", String(port), "--db", dbPath], {
    env: {
      ...process.env,
      MATRIX_PORT: String(port),
      MATRIX_TOKEN: token,
      MATRIX_HOST: "127.0.0.1",
      // Prevent the second server from conflicting with the first
      MATRIX_LOCAL: "false",
      // Isolate config files (server-config.json) so second server
      // doesn't overwrite the primary server's defaultAgent
      MATRIX_DATA_DIR: tmpDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
    cwd: PROJECT_ROOT,
  });

  // Log stderr for debugging
  child.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error(`[second-server:${port}] ${msg}`);
  });

  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Second server ${method} ${path} returned ${res.status}: ${text}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  };

  // Wait for server to be reachable
  for (let i = 0; i < 30; i++) {
    try {
      await request("GET", "/server/config");
      break;
    } catch {
      if (i === 29) {
        child.kill();
        throw new Error(`Second server not reachable after 30s on port ${port}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  let mockAgentId: string | null = null;

  // Register mock agent (same as global-setup does for the primary server)
  if (!process.env.REAL_AGENT) {
    try {
      const mockAgentPath = resolve(__dirname, "../fixtures/mock-agent/index.mjs");
      const res = (await request("POST", "/custom-agents", {
        name: "Mock Agent",
        command: "node",
        args: [mockAgentPath],
      })) as { id: string };
      mockAgentId = res.id;
      await request("PUT", "/server/config", { defaultAgent: res.id });
    } catch (err) {
      console.error("[second-server] Mock agent registration failed:", err);
    }
  }

  const teardown = async () => {
    // Remove mock agent
    if (mockAgentId) {
      await request("DELETE", `/custom-agents/${mockAgentId}`).catch(() => {});
    }
    // Kill server process
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
    });
    // Clean up temp DB
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };

  return {
    port,
    token,
    baseUrl,
    process: child,
    dbPath,
    mockAgentId,
    request,
    teardown,
  };
}
