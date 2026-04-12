import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { TooltipProvider } from "./components/ui/tooltip";
import {
  installAutomationBridge,
  shouldInstallBridge,
  connectBridgeWebSocket,
} from "./automation/bridge";
import { getLocalServerUrl, hasLocalServer, isMobilePlatform } from "./lib/platform";
import { logger } from "./lib/logger";

installAutomationBridge();

// Connect automation bridge via WebSocket to the server
if (shouldInstallBridge()) {
  void (async () => {
    try {
      // Determine server URL
      let serverUrl: string;
      if (hasLocalServer()) {
        serverUrl = await getLocalServerUrl();
      } else {
        // iOS / web: derive from URL params, Vite env vars, or current origin
        const params = new URLSearchParams(window.location.search);
        const devServerUrl = import.meta.env.VITE_MATRIX_URL
          || (import.meta.env.VITE_MATRIX_PORT ? `http://127.0.0.1:${import.meta.env.VITE_MATRIX_PORT}` : undefined);
        const paramUrl = params.get("serverUrl") || devServerUrl;
        if (paramUrl) {
          serverUrl = paramUrl;
        } else {
          // When served by the matrix server, use same origin
          serverUrl = window.location.origin;
        }
      }

      // Fetch auth token
      const authRes = await fetch(`${serverUrl}/api/auth-info`, {
        headers: {
          "X-Matrix-Internal": "true",
        },
      });
      if (!authRes.ok) {
        logger.warn("[bridge-ws] Could not fetch auth-info, skipping bridge WebSocket");
        return;
      }
      const { token } = (await authRes.json()) as { token: string };

      const platform = isMobilePlatform() ? "ios" : "macos";
      connectBridgeWebSocket(serverUrl, token, platform, "main");
    } catch (err) {
      logger.error("[bridge-ws] Failed to connect", err);
    }
  })();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
