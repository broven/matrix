import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MatrixClientProvider } from "./hooks/useMatrixClient";
import { ConnectionStatusBar } from "./components/ConnectionStatusBar";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SessionPage } from "./pages/SessionPage";

export function App() {
  return (
    <MatrixClientProvider>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <ConnectionStatusBar />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ConnectPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/session/:sessionId" element={<SessionPage />} />
          </Routes>
        </BrowserRouter>
      </div>
    </MatrixClientProvider>
  );
}
