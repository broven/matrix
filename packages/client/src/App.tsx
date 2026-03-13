import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SessionPage } from "./pages/SessionPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ConnectPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/session/:sessionId" element={<SessionPage />} />
      </Routes>
    </BrowserRouter>
  );
}
