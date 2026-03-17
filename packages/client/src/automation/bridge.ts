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

export interface AutomationBridge {
  getSnapshot: () => Record<string, unknown>;
  resetTestState: () => void;
  dispatchEvent: (name: string, payload?: unknown) => void;
}

const BRIDGE_KEY = "__MATRIX_AUTOMATION__";

function shouldInstallBridge(options?: InstallOptions): boolean {
  const mode = options?.mode ?? (import.meta.env.MODE as RuntimeMode);
  const dev = options?.dev ?? import.meta.env.DEV;
  return dev || mode === "test";
}

function getSnapshot(): Record<string, unknown> {
  return {
    url: window.location.href,
    title: document.title,
    readyState: document.readyState,
    userAgent: navigator.userAgent,
    testState: readAutomationTestState(),
    timestamp: Date.now(),
  };
}

export function installAutomationBridge(options?: InstallOptions): AutomationBridge | null {
  if (!shouldInstallBridge(options)) {
    return null;
  }

  const bridge: AutomationBridge = {
    getSnapshot,
    resetTestState: resetAutomationTestState,
    dispatchEvent: dispatchAutomationEvent,
  };

  (window as any)[BRIDGE_KEY] = bridge;
  return bridge;
}
