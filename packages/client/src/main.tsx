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
        // iOS / web: derive from current page URL or URL params
        const params = new URLSearchParams(window.location.search);
        const paramUrl = params.get("serverUrl");
        if (paramUrl) {
          serverUrl = paramUrl;
        } else {
          // When served by the matrix server, use same origin
          serverUrl = window.location.origin;
        }
      }

      // Fetch auth token
      const authRes = await fetch(`${serverUrl}/api/auth-info`);
      if (!authRes.ok) {
        console.warn("[bridge-ws] Could not fetch auth-info, skipping bridge WebSocket");
        return;
      }
      const { token } = (await authRes.json()) as { token: string };

      const platform = isMobilePlatform() ? "ios" : "macos";
      connectBridgeWebSocket(serverUrl, token, platform, "main");
    } catch (err) {
      console.error("[bridge-ws] Failed to connect:", err);
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
