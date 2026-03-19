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

type RuntimeBridgeRequest =
  | {
      id: number;
      responseEvent: string;
      request: { kind: "eval"; script: string };
    }
  | {
      id: number;
      responseEvent: string;
      request: { kind: "dispatchEvent"; name: string; payload?: unknown };
    }
  | {
      id: number;
      responseEvent: string;
      request: { kind: "snapshot" };
    };

type RuntimeBridgeResponse =
  | {
      id: number;
      ok: true;
      result: JsonSafeValue;
      error: null;
    }
  | {
      id: number;
      ok: false;
      result: null;
      error: "webview_unavailable" | "internal_error";
    };

const BRIDGE_KEY = "__MATRIX_AUTOMATION__";
const RUNTIME_REQUEST_EVENT = "matrix:automation:runtime-request";
let runtimeBridgeListenerPromise: Promise<void> | null = null;

type JsonSafeValue =
  | null
  | boolean
  | number
  | string
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue };

function shouldInstallBridge(options?: InstallOptions): boolean {
  const mode = options?.mode ?? (import.meta.env.MODE as RuntimeMode);
  const dev = options?.dev ?? import.meta.env.DEV;
  return dev || mode === "test";
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

function toRuntimeResponse(
  id: number,
  response: AutomationScriptResponse,
): RuntimeBridgeResponse {
  if (response.ok) {
    return {
      id,
      ok: true,
      result: response.result,
      error: null,
    };
  }

  return {
    id,
    ok: false,
    result: null,
    error: "internal_error",
  };
}

function handleRuntimeRequest(request: RuntimeBridgeRequest): RuntimeBridgeResponse {
  const bridge = getAutomationBridge();
  if (!bridge) {
    return {
      id: request.id,
      ok: false,
      result: null,
      error: "webview_unavailable",
    };
  }

  try {
    switch (request.request.kind) {
      case "eval":
        return toRuntimeResponse(request.id, bridge.runScript(request.request.script));
      case "dispatchEvent":
        bridge.dispatchEvent(request.request.name, request.request.payload);
        return {
          id: request.id,
          ok: true,
          result: null,
          error: null,
        };
      case "snapshot":
        return {
          id: request.id,
          ok: true,
          result: toJsonSafe(bridge.getSnapshot()),
          error: null,
        };
      default:
        return {
          id: request.id,
          ok: false,
          result: null,
          error: "internal_error",
        };
    }
  } catch {
    return {
      id: request.id,
      ok: false,
      result: null,
      error: "internal_error",
    };
  }
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

export async function installAutomationRuntimeBridgeListener(
  options?: InstallOptions,
): Promise<void> {
  if (!shouldInstallBridge(options)) {
    return;
  }

  if (runtimeBridgeListenerPromise) {
    return runtimeBridgeListenerPromise;
  }

  runtimeBridgeListenerPromise = (async () => {
    const { listen, emit } = await import("@tauri-apps/api/event");

    await listen<RuntimeBridgeRequest>(RUNTIME_REQUEST_EVENT, async (event) => {
      const response = handleRuntimeRequest(event.payload);
      await emit(event.payload.responseEvent, response);
    });
  })();

  return runtimeBridgeListenerPromise;
}
