import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMatrixClient } from "../hooks/useMatrixClient";
import QRCode from "qrcode";

function buildConnectionUri(serverUrl: string, token: string): string {
  const params = new URLSearchParams({ serverUrl, token });
  return `matrix://connect?${params.toString()}`;
}

export function ConnectPage() {
  const navigate = useNavigate();
  const { connect, status, connectionInfo, restoreLastConnection } = useMatrixClient();
  const [serverUrl, setServerUrl] = useState("http://localhost:8080");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    restoreLastConnection();
    const saved = localStorage.getItem("matrix:lastConnection");
    if (saved) {
      const { serverUrl: url, token: tok } = JSON.parse(saved);
      setServerUrl(url);
      setToken(tok);
    }
  }, [restoreLastConnection]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get("serverUrl");
    const paramToken = params.get("token");
    if (paramUrl) setServerUrl(paramUrl);
    if (paramToken) setToken(paramToken);
  }, []);

  useEffect(() => {
    if (status === "connected") {
      navigate("/dashboard");
    }
  }, [status, navigate]);

  useEffect(() => {
    if (!serverUrl || !token) {
      setQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(buildConnectionUri(serverUrl, token), {
      margin: 1,
      width: 180,
    }).then(setQrDataUrl);
  }, [serverUrl, token]);

  const handleConnect = () => {
    if (!serverUrl || !token) {
      setError("Server URL and token are required");
      return;
    }
    setError("");
    connect({ serverUrl, token });
  };

  return (
    <div style={{ maxWidth: 560, margin: "80px auto", padding: 20 }}>
      <h1>Matrix</h1>
      <p>Connect to your ACP Server</p>

      <div style={{ display: "grid", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label>
          Server URL
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:8080"
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>

        <label>
          Token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your server token"
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>

        {error && <p style={{ color: "red" }}>{error}</p>}

        <button
          onClick={handleConnect}
          disabled={status === "connecting"}
          style={{ padding: "10px 20px", cursor: "pointer" }}
        >
          {status === "connecting" ? "Connecting..." : "Connect"}
        </button>

        <p>Status: {status}</p>
        </div>

        <section
          style={{
            display: "flex",
            gap: 16,
            alignItems: "center",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ minWidth: 180, minHeight: 180, display: "grid", placeItems: "center", background: "#f8fafc", borderRadius: 8 }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Connection QR" width={180} height={180} />
            ) : (
              <span style={{ fontSize: 12, color: "#64748b" }}>Enter server URL and token to generate QR</span>
            )}
          </div>
          <div style={{ display: "grid", gap: 8, flex: 1 }}>
            <strong>Connection Info</strong>
            <div style={{ fontSize: 13, color: "#475569" }}>
              <div>Server: {(connectionInfo?.serverUrl ?? serverUrl) || "-"}</div>
              <div>Token: {(connectionInfo?.tokenMasked ?? (token ? `${token.slice(0, 4)}...${token.slice(-4)}` : "-"))}</div>
              <div>Transport: {connectionInfo?.transport ?? "auto"}</div>
              <div>Source: {connectionInfo?.source ?? "manual"}</div>
            </div>
            <input
              readOnly
              value={serverUrl && token ? buildConnectionUri(serverUrl, token) : ""}
              style={{ width: "100%", padding: 8, fontSize: 12 }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
