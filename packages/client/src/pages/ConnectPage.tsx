import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMatrixClient } from "../hooks/useMatrixClient";

export function ConnectPage() {
  const navigate = useNavigate();
  const { connect, status } = useMatrixClient();
  const [serverUrl, setServerUrl] = useState("http://localhost:8080");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("matrix:lastConnection");
    if (saved) {
      const { serverUrl: url, token: tok } = JSON.parse(saved);
      setServerUrl(url);
      setToken(tok);
    }
  }, []);

  useEffect(() => {
    if (status === "connected") {
      navigate("/dashboard");
    }
  }, [status, navigate]);

  const handleConnect = () => {
    if (!serverUrl || !token) {
      setError("Server URL and token are required");
      return;
    }
    setError("");
    connect({ serverUrl, token });
  };

  return (
    <div style={{ maxWidth: 400, margin: "100px auto", padding: 20 }}>
      <h1>Matrix</h1>
      <p>Connect to your ACP Server</p>

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
    </div>
  );
}
