import {
  dispatchAutomationEvent,
  readAutomationTestState,
  resetAutomationTestState,
} from "./test-hooks";

type RuntimeMode = "development" | "test" | "production";

interface InstallOptions {
  mode?: RuntimeMode;
  dev?: boolean;
}

export interface AutomationScriptError {
  name: string;
  message: string;
  stack?: string;
}

export interface AutomationScriptSuccess {
  ok: true;
  result: JsonSafeValue;
  error: null;
}

export interface AutomationScriptFailure {
  ok: false;
  result: null;
  error: AutomationScriptError;
}

export type AutomationScriptResponse = AutomationScriptSuccess | AutomationScriptFailure;

export interface AutomationBridge {
  getSnapshot: () => Record<string, unknown>;
  resetTestState: (scopes?: string[]) => void;
  dispatchEvent: (name: string, payload?: unknown) => void;
  runScript: (script: string) => AutomationScriptResponse;
}

const BRIDGE_KEY = "__MATRIX_AUTOMATION__";

type JsonSafeValue =
  | null
  | boolean
  | number
  | string
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue };

export function shouldInstallBridge(options?: InstallOptions): boolean {
  const mode = options?.mode ?? (import.meta.env.MODE as RuntimeMode);
  const dev = options?.dev ?? import.meta.env.DEV;
  // Always install when running inside Tauri (even release builds).
  // The Rust automation server only starts in debug builds, so the bridge
  // is inert in production — no server listens, no external access.
  const inTauri = "__TAURI_INTERNALS__" in window;
  return dev || mode === "test" || inTauri;
}

function toJsonSafe(value: unknown, path = new WeakSet<object>()): JsonSafeValue {
  if (value === null) return null;

  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") {
    return value as string | boolean;
  }
  if (valueType === "number") {
    return Number.isFinite(value as number) ? (value as number) : null;
  }
  if (valueType === "bigint") {
    return (value as bigint).toString();
  }
  if (valueType === "undefined" || valueType === "function" || valueType === "symbol") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (Array.isArray(value)) {
    if (path.has(value)) {
      return null;
    }
    path.add(value);
    try {
      return value.map((item) => toJsonSafe(item, path));
    } finally {
      path.delete(value);
    }
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (path.has(obj)) {
      return null;
    }
    path.add(obj);
    try {
      const output: { [key: string]: JsonSafeValue } = {};
      for (const [key, item] of Object.entries(obj)) {
        output[key] = toJsonSafe(item, path);
      }
      return output;
    } finally {
      path.delete(obj);
    }
  }

  return null;
}

function toScriptError(error: unknown): AutomationScriptError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return {
      name: "Error",
      message: error,
    };
  }

  return {
    name: "Error",
    message: "script_execution_failed",
  };
}

function executeScript(script: string): unknown {
  // Run as a global expression to avoid exposing bridge-local bindings to scripts.
  return Function('"use strict"; return (' + script + ");")();
}

function getSnapshot(): Record<string, unknown> {
  return {
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    userAgent: navigator.userAgent,
    testState: toJsonSafe(readAutomationTestState()),
    timestamp: Date.now(),
  };
}

function getAutomationBridge(): AutomationBridge | null {
  return ((window as any)[BRIDGE_KEY] as AutomationBridge | undefined) ?? null;
}

export function installAutomationBridge(options?: InstallOptions): AutomationBridge | null {
  if (!shouldInstallBridge(options)) {
    return null;
  }

  const bridge: AutomationBridge = {
    getSnapshot,
    resetTestState: resetAutomationTestState,
    dispatchEvent: dispatchAutomationEvent,
    runScript(script: string): AutomationScriptResponse {
      try {
        const result = executeScript(script);
        return {
          ok: true,
          result: toJsonSafe(result),
          error: null,
        };
      } catch (error) {
        return {
          ok: false,
          result: null,
          error: toScriptError(error),
        };
      }
    },
  };

  (window as any)[BRIDGE_KEY] = bridge;
  return bridge;
}

// --- WebSocket Bridge Client ---

interface BridgeServerMessage {
  type: "eval" | "event" | "reset";
  requestId: string;
  script?: string;
  name?: string;
  payload?: unknown;
  scopes?: string[];
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * Connect to the bridge server via WebSocket.
 * Handles incoming eval/event/reset commands and auto-reconnects.
 */
export function connectBridgeWebSocket(
  serverUrl: string,
  token: string,
  platform: string,
  label: string,
): { close: () => void } {
  let ws: WebSocket | null = null;
  let reconnectAttempt = 0;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;

    const wsUrl = serverUrl.replace(/^http/, "ws") + `/bridge?token=${encodeURIComponent(token)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectAttempt = 0;
      // Send register message with auth token
      ws!.send(JSON.stringify({
        type: "register",
        token,
        platform,
        label,
        userAgent: navigator.userAgent,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as BridgeServerMessage | { type: string; clientId?: string };

        if (msg.type === "registered" || msg.type === "authenticated" || msg.type === "pong") {
          return;
        }

        if (msg.type === "error") {
          console.warn("[bridge-ws] Server error:", msg);
          return;
        }

        handleServerMessage(msg as BridgeServerMessage);
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      ws = null;
      if (!closed) {
        const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
        reconnectAttempt++;
        console.log(`[bridge-ws] Disconnected, reconnecting in ${delay}ms...`);
        reconnectTimer = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }

  function handleServerMessage(msg: BridgeServerMessage) {
    const bridge = getAutomationBridge();
    if (!bridge || !ws) return;

    const { requestId } = msg;

    switch (msg.type) {
      case "eval": {
        const response = bridge.runScript(msg.script!);
        ws.send(JSON.stringify({
          type: "response",
          requestId,
          result: response.ok ? response.result : null,
          error: response.ok ? undefined : response.error.message,
        }));
        break;
      }

      case "event": {
        try {
          bridge.dispatchEvent(msg.name!, msg.payload);
          ws.send(JSON.stringify({ type: "response", requestId, result: null }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: "response",
            requestId,
            error: err instanceof Error ? err.message : "event dispatch failed",
          }));
        }
        break;
      }

      case "reset": {
        try {
          bridge.resetTestState(msg.scopes);
          ws.send(JSON.stringify({ type: "response", requestId, result: null }));
        } catch (err) {
          ws.send(JSON.stringify({
            type: "response",
            requestId,
            error: err instanceof Error ? err.message : "reset failed",
          }));
        }
        break;
      }
    }
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    },
  };
}
