import { MatrixClientProvider, useMatrixClient } from "./hooks/useMatrixClient";
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

function AppContent() {
  const { client } = useMatrixClient();

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
      <UpdateProvider>
        <AppContent />
      </UpdateProvider>
    </MatrixClientProvider>
  );
}
