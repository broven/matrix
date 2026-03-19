import { beforeAll } from "vitest";
import { rm } from "node:fs/promises";
import { createBridgeClient, type BridgeClient } from "./lib/bridge-client";
import { setBridge } from "./lib/ui";

let bridge: BridgeClient;
let initialized = false;

async function getSidecarInfo(b: BridgeClient) {
  const state = await b.state();
  const port = (state.sidecar as { port: number }).port;
  const sidecarUrl = `http://127.0.0.1:${port}`;
  const res = await fetch(sidecarUrl + "/api/auth-info");
  const { token } = (await res.json()) as { token: string };
  return { sidecarUrl, sidecarToken: token };
}

async function cleanAll(b: BridgeClient) {
  const { sidecarUrl, sidecarToken } = await getSidecarInfo(b);

  const configRes = await fetch(`${sidecarUrl}/server/config`, {
    headers: { Authorization: `Bearer ${sidecarToken}` },
  });
  const config = (await configRes.json()) as { reposPath: string };

  // Delete all repos from sidecar DB
  const reposRes = await fetch(`${sidecarUrl}/repositories`, {
    headers: { Authorization: `Bearer ${sidecarToken}` },
  });
  if (reposRes.ok) {
    const repos = (await reposRes.json()) as { id: string }[];
    for (const repo of repos) {
      await fetch(`${sidecarUrl}/repositories/${repo.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sidecarToken}` },
      });
    }
  }

  // Remove clone target directories
  for (const name of ["matrix-test-clone", "matrix-test-local"]) {
    await rm(`${config.reposPath}/${name}`, { recursive: true, force: true }).catch(() => {});
  }

  // Reload webview and wait for full recovery
  await b.invoke("window.reload");
  await b.wait(
    { kind: "webview.eval", script: "!!document.querySelector('[data-testid=\"connection-status-connected\"]')" },
    { timeoutMs: 20_000, intervalMs: 500 },
  );
}

beforeAll(async () => {
  if (!initialized) {
    initialized = true;

    // First run: create bridge, verify health, then clean
    bridge = await createBridgeClient();
    setBridge(bridge);

    const health = await bridge.health();
    if (!health.ok) throw new Error("Automation bridge health check failed — is the app running?");
    if (!health.webviewReady) throw new Error("Webview is not ready");
    if (!health.sidecarReady) throw new Error("Sidecar is not ready");

    await cleanAll(bridge);
  }

  // Subsequent files: just refresh the bridge reference
  bridge = await createBridgeClient();
  setBridge(bridge);
});

export { bridge };
