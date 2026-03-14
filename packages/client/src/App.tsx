import { MatrixClientProvider, useMatrixClient } from "./hooks/useMatrixClient";
import { AppLayout } from "./components/layout/AppLayout";
import { ConnectPage } from "./pages/ConnectPage";

function AppContent() {
  const { client } = useMatrixClient();

  if (!client) {
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
