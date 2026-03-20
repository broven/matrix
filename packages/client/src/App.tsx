import { useEffect, useRef } from "react";
import { MatrixClientProvider, useMatrixClient } from "./hooks/useMatrixClient";
import { ServerStoreProvider, useServerStore } from "./hooks/useServerStore";
import { AppLayout } from "./components/layout/AppLayout";
import { ConnectPage } from "./pages/ConnectPage";
import { UpdateToast } from "./components/UpdateToast";
import { UpdateProvider, useAutoUpdate } from "./hooks/useAutoUpdate";
import { hasLocalServer } from "./lib/platform";

function AutoUpdateToast() {
  const update = useAutoUpdate();
  return (
    <UpdateToast
      state={update.state}
      updateInfo={update.updateInfo}
      progress={update.progress}
      error={update.error}
      onDownload={update.downloadUpdate}
      onInstall={update.installUpdate}
      onDismiss={update.dismiss}
    />
  );
}

/**
 * Handles deep-link URL params and auto-reconnect for saved servers.
 * Runs on all platforms (desktop + mobile) since it's in AppContent.
 */
function useAutoReconnect() {
  const { connect, status } = useMatrixClient();
  const { addServer } = useServerStore();
  const didAutoReconnect = useRef(false);

  // Parse deep-link URL params: ?serverUrl=...&token=...&autoConnect=1
  // iOS dev mode: auto-connect using VITE_MATRIX_PORT + VITE_MATRIX_TOKEN from .env.local
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // On mobile dev: auto-connect using VITE_MATRIX_PORT + VITE_MATRIX_TOKEN
    const devServerUrl = !hasLocalServer() && import.meta.env.VITE_MATRIX_PORT
      ? `http://127.0.0.1:${import.meta.env.VITE_MATRIX_PORT}`
      : undefined;
    const paramUrl = params.get("serverUrl") || devServerUrl;
    const paramToken = params.get("token") || (devServerUrl ? import.meta.env.VITE_MATRIX_TOKEN : undefined);
    const autoConnect = params.get("autoConnect") === "1" || !!(devServerUrl && paramToken);

    if (autoConnect && paramUrl && paramToken) {
      let name: string;
      try {
        name = new URL(paramUrl).host;
      } catch {
        name = paramUrl;
      }
      addServer({ name, serverUrl: paramUrl, token: paramToken });
      connect({ serverUrl: paramUrl, token: paramToken }, { source: "manual" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [connect, addServer]);

  // Auto-reconnect last saved connection from sessionStorage
  useEffect(() => {
    if (didAutoReconnect.current) return;
    // On desktop, the local sidecar auto-connect in useMatrixClient takes precedence
    if (hasLocalServer()) return;
    if (status !== "offline") return;
    didAutoReconnect.current = true;

    const saved = sessionStorage.getItem("matrix:lastConnection");
    if (saved) {
      const { serverUrl, token, serverId } = JSON.parse(saved) as {
        serverUrl: string;
        token: string;
        serverId?: string;
      };
      connect({ serverUrl, token }, { source: "storage", serverId });
    }
  }, [connect, status]);
}

function AppContent() {
  const { client } = useMatrixClient();

  // Run auto-reconnect/deep-link on all platforms
  useAutoReconnect();

  // Desktop with local server: skip ConnectPage, go straight to AppLayout
  // Auto-connect happens in the background via useMatrixClient
  if (!client && !hasLocalServer()) {
    return <ConnectPage />;
  }

  return (
    <>
      <AppLayout />
      <AutoUpdateToast />
    </>
  );
}

export function App() {
  return (
    <MatrixClientProvider>
      <ServerStoreProvider>
        <UpdateProvider>
          <AppContent />
        </UpdateProvider>
      </ServerStoreProvider>
    </MatrixClientProvider>
  );
}
