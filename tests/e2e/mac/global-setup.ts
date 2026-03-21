import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let mockAgentId: string | null = null;

function getServerInfo() {
  const port = process.env.MATRIX_PORT;
  if (!port) throw new Error("MATRIX_PORT env var is required");
  const token = process.env.MATRIX_TOKEN;
  if (!token) throw new Error("MATRIX_TOKEN env var is required");
  return { baseUrl: `http://127.0.0.1:${port}`, token };
}

async function serverRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const { baseUrl, token } = getServerInfo();
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
    throw new Error(`${method} ${path} returned ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

async function cleanAll() {
  const { baseUrl, token } = getServerInfo();

  // Get repos path from server config
  const config = (await serverRequest("GET", "/server/config")) as { reposPath: string };

  // Delete all repos (and their worktrees)
  const repos = (await serverRequest("GET", "/repositories")) as { id: string }[];
  for (const repo of repos) {
    // Delete worktrees first (repo delete fails if worktrees exist)
    try {
      const worktrees = (await serverRequest("GET", `/repositories/${repo.id}/worktrees`)) as { id: string }[];
      for (const wt of worktrees) {
        await serverRequest("DELETE", `/worktrees/${wt.id}`).catch(() => {});
      }
    } catch {
      // Continue
    }
    await serverRequest("DELETE", `/repositories/${repo.id}`).catch(() => {});
  }

  // Remove clone target directories
  for (const name of ["matrix-test-clone", "matrix-test-local"]) {
    await rm(`${config.reposPath}/${name}`, { recursive: true, force: true }).catch(() => {});
  }

  // Reload webview via bridge eval
  try {
    await fetch(`${baseUrl}/bridge/eval`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ script: "window.location.reload()" }),
    });
  } catch {
    // Client might disconnect during reload — that's expected
  }
}

export async function setup() {
  const { baseUrl, token } = getServerInfo();

  // Wait for server to be reachable (wireit starts services in parallel with vitest)
  for (let i = 0; i < 60; i++) {
    try {
      await serverRequest("GET", "/server/config");
      break;
    } catch {
      if (i === 59) throw new Error("Server not reachable after 60s");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Pre-test cleanup
  try {
    await cleanAll();
  } catch (err) {
    console.error("[global-setup] cleanAll failed:", err);
  }

  // Wait for webview to be ready via bridge
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${baseUrl}/bridge/eval`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ script: "!!document.querySelector('[data-testid=\"add-repo-btn\"]')" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; result: unknown };
        if (data.ok && data.result === true) break;
      }
    } catch {
      // Not ready yet
    }
  }

  // Register mock agent as default (skip when using real agents)
  if (!process.env.REAL_AGENT) {
    try {
      // Clean up stale Mock Agents from previous runs (e.g. killed without teardown)
      const existingAgents = (await serverRequest("GET", "/custom-agents")) as { id: string; name: string }[];
      for (const agent of existingAgents) {
        if (agent.name === "Mock Agent") {
          await serverRequest("DELETE", `/custom-agents/${agent.id}`).catch(() => {});
        }
      }

      const mockAgentPath = resolve(__dirname, "fixtures/mock-agent/index.mjs");

      const res = (await serverRequest("POST", "/custom-agents", {
        name: "Mock Agent",
        command: "node",
        args: [mockAgentPath],
      })) as { id: string };
      mockAgentId = res.id;

      // Set as default agent
      await serverRequest("PUT", "/server/config", { defaultAgent: res.id });

      // Reload webview so it picks up the new agent list and default
      try {
        await fetch(`${baseUrl}/bridge/eval`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ script: "window.location.reload()" }),
        });
      } catch {
        // Client may disconnect during reload
      }

      // Wait for webview to come back with the mock agent visible
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const evalRes = await fetch(`${baseUrl}/bridge/eval`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ script: `!!document.querySelector('[data-testid="add-repo-btn"]')` }),
          });
          if (evalRes.ok) {
            const data = (await evalRes.json()) as { ok: boolean; result: unknown };
            if (data.ok && data.result === true) break;
          }
        } catch {
          // Not ready yet
        }
      }
    } catch (err) {
      console.error("[global-setup] Mock agent registration failed:", err);
    }
  }
}

export async function teardown() {
  // Remove mock agent if registered
  if (mockAgentId) {
    try {
      await serverRequest("DELETE", `/custom-agents/${mockAgentId}`).catch(() => {});
    } catch {
      // Best effort
    }
  }

  // Post-test cleanup
  try {
    await cleanAll();
  } catch {
    // Best effort
  }
}
