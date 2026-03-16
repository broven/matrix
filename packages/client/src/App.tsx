import { MatrixClientProvider, useMatrixClient } from "./hooks/useMatrixClient";
import { AppLayout } from "./components/layout/AppLayout";
import { ConnectPage } from "./pages/ConnectPage";
import { hasLocalServer } from "./lib/platform";

function AppContent() {
  const { client } = useMatrixClient();

  // Desktop with local server: skip ConnectPage, go straight to AppLayout
  // Auto-connect happens in the background via useMatrixClient
  if (!client && !hasLocalServer()) {
    return <ConnectPage />;
  }

  return <AppLayout />;
}

export function App() {
  return (
    <MatrixClientProvider>
      <AppContent />
    </MatrixClientProvider>
  );
}
