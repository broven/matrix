import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MatrixClientProvider } from "./hooks/useMatrixClient";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SessionPage } from "./pages/SessionPage";

export function App() {
  return (
    <MatrixClientProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ConnectPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/session/:sessionId" element={<SessionPage />} />
        </Routes>
      </BrowserRouter>
    </MatrixClientProvider>
  );
}
