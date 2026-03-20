import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

let mockAgentId: string | null = null;

const DISCOVERY_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Matrix",
  "dev",
  "automation.json",
);

async function getBridgeAndSidecar() {
  const raw = await readFile(DISCOVERY_PATH, "utf-8");
  const discovery = JSON.parse(raw) as { baseUrl: string; token: string };

  const stateRes = await fetch(`${discovery.baseUrl}/state`, {
    headers: { Authorization: `Bearer ${discovery.token}` },
  });
  const state = (await stateRes.json()) as { sidecar: { port: number } };
  const sidecarUrl = `http://127.0.0.1:${state.sidecar.port}`;

  const authRes = await fetch(`${sidecarUrl}/api/auth-info`);
  const { token: sidecarToken } = (await authRes.json()) as { token: string };

  const configRes = await fetch(`${sidecarUrl}/server/config`, {
    headers: { Authorization: `Bearer ${sidecarToken}` },
  });
  const config = (await configRes.json()) as { reposPath: string };

  return { discovery, sidecarUrl, sidecarToken, reposPath: config.reposPath };
}

async function cleanAll() {
  const { discovery, sidecarUrl, sidecarToken, reposPath } = await getBridgeAndSidecar();

  // Delete all repos (and their worktrees) from sidecar DB
  const reposRes = await fetch(`${sidecarUrl}/repositories`, {
    headers: { Authorization: `Bearer ${sidecarToken}` },
  });
  if (reposRes.ok) {
    const repos = (await reposRes.json()) as { id: string }[];
    for (const repo of repos) {
      // Delete worktrees first (repo delete fails if worktrees exist)
      const wtRes = await fetch(`${sidecarUrl}/repositories/${repo.id}/worktrees`, {
        headers: { Authorization: `Bearer ${sidecarToken}` },
      });
      if (wtRes.ok) {
        const worktrees = (await wtRes.json()) as { id: string }[];
        for (const wt of worktrees) {
          await fetch(`${sidecarUrl}/worktrees/${wt.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${sidecarToken}` },
          }).catch(() => {});
        }
      }
      await fetch(`${sidecarUrl}/repositories/${repo.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sidecarToken}` },
      }).catch(() => {});
    }
  }

  // Remove clone target directories
  for (const name of ["matrix-test-clone", "matrix-test-local"]) {
    await rm(`${reposPath}/${name}`, { recursive: true, force: true }).catch(() => {});
  }

  // Reload webview to reflect clean state
  await fetch(`${discovery.baseUrl}/native/invoke`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${discovery.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "window.reload" }),
  });
}

export async function setup() {
  // Pre-test cleanup
  try {
    await cleanAll();
    // Wait for reload to settle, then poll until webview is ready
    const raw = await readFile(DISCOVERY_PATH, "utf-8");
    const discovery = JSON.parse(raw) as { baseUrl: string; token: string };
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`${discovery.baseUrl}/webview/eval`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${discovery.token}`,
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
  } catch {
    // App might not be running yet, that's OK — setup.ts will catch it
  }

  // Register mock agent as default (skip when using real agents)
  if (!process.env.REAL_AGENT) {
    try {
      const { sidecarUrl, sidecarToken } = await getBridgeAndSidecar();
      const mockAgentPath = resolve(__dirname, "fixtures/mock-agent/index.mjs");

      const res = await fetch(`${sidecarUrl}/custom-agents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sidecarToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Mock Agent",
          command: "node",
          args: [mockAgentPath],
        }),
      });
      if (res.ok) {
        const agent = (await res.json()) as { id: string };
        mockAgentId = agent.id;

        // Set as default agent
        await fetch(`${sidecarUrl}/server/config`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${sidecarToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ defaultAgent: agent.id }),
        });
      }
    } catch {
      // Mock agent registration failed — tests will use whatever agent is available
    }
  }
}

export async function teardown() {
  // Remove mock agent if registered
  if (mockAgentId) {
    try {
      const { sidecarUrl, sidecarToken } = await getBridgeAndSidecar();
      await fetch(`${sidecarUrl}/custom-agents/${mockAgentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sidecarToken}` },
      }).catch(() => {});
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
