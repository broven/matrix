#!/usr/bin/env node

/**
 * Polls the iOS automation bridge until webview is ready,
 * then injects auto-connect query params to connect to the dev server.
 */

const port = process.env.MATRIX_AUTOMATION_PORT_IOS || "18766";
const token = process.env.MATRIX_AUTOMATION_TOKEN || "dev";
const serverPort = process.env.MATRIX_PORT || "8080";
const serverToken = process.env.MATRIX_TOKEN || "test";
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForBridge() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.webviewReady) return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function waitForWebviewEval() {
  // The bridge health reports webviewReady but the React app may not have loaded yet.
  // Poll with a simple eval until it succeeds.
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${baseUrl}/webview/eval`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ script: "document.readyState" }),
      });
      const data = await res.json();
      if (data.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function injectAutoConnect() {
  const serverUrl = encodeURIComponent(`http://127.0.0.1:${serverPort}`);
  const tk = encodeURIComponent(serverToken);
  const script = `window.location.replace(window.location.pathname + "?serverUrl=${serverUrl}&token=${tk}&autoConnect=1")`;

  const res = await fetch(`${baseUrl}/webview/eval`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ script }),
  });
  const data = await res.json();
  if (data.ok) {
    console.log("[ios-autoconnect] Connected to dev server at http://127.0.0.1:" + serverPort);
  } else {
    console.error("[ios-autoconnect] Failed to inject auto-connect:", data.error);
  }
}

async function main() {
  try {
    console.log("[ios-autoconnect] Waiting for iOS automation bridge...");
    const ready = await waitForBridge();
    if (!ready) {
      console.error("[ios-autoconnect] Bridge not ready after 4 minutes");
    } else {
      console.log("[ios-autoconnect] Bridge ready, waiting for webview to load...");
      const evalReady = await waitForWebviewEval();
      if (!evalReady) {
        console.error("[ios-autoconnect] Webview eval not available after 60s");
      } else {
        console.log("[ios-autoconnect] Webview ready, injecting auto-connect...");
        await injectAutoConnect();
      }
    }
  } catch (err) {
    console.error("[ios-autoconnect] Error:", err.message);
  }
  // Stay alive so wireit doesn't exit
  console.log("[ios-autoconnect] Keeping alive...");
  setInterval(() => {}, 60_000);
}

main();
