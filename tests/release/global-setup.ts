import { rm } from "node:fs/promises";

function getBridgeConfig() {
  const port = process.env.MATRIX_AUTOMATION_PORT ?? "18765";
  const token = process.env.MATRIX_AUTOMATION_TOKEN ?? "dev";
  const baseUrl = `http://127.0.0.1:${port}`;
  return { baseUrl, token };
}

async function getBridgeAndSidecar() {
  const { baseUrl, token } = getBridgeConfig();

  const stateRes = await fetch(`${baseUrl}/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const state = (await stateRes.json()) as { sidecar: { port: number } };
  const sidecarUrl = `http://127.0.0.1:${state.sidecar.port}`;

  const authRes = await fetch(`${sidecarUrl}/api/auth-info`);
  const { token: sidecarToken } = (await authRes.json()) as { token: string };

  const configRes = await fetch(`${sidecarUrl}/server/config`, {
    headers: { Authorization: `Bearer ${sidecarToken}` },
  });
  const config = (await configRes.json()) as { reposPath: string };

  return { baseUrl, token, sidecarUrl, sidecarToken, reposPath: config.reposPath };
}

async function cleanAll() {
  const { baseUrl, token, sidecarUrl, sidecarToken, reposPath } = await getBridgeAndSidecar();

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
  await fetch(`${baseUrl}/native/invoke`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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
    const { baseUrl, token } = getBridgeConfig();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`${baseUrl}/webview/eval`, {
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
  } catch {
    // App might not be running yet, that's OK — setup.ts will catch it
  }
}

export async function teardown() {
  // Post-test cleanup
  try {
    await cleanAll();
  } catch {
    // Best effort
  }
}
