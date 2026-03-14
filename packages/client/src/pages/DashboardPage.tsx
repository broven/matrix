import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMatrixClient } from "../hooks/useMatrixClient";
import type { AgentListItem, SessionInfo } from "@matrix/protocol";

export function DashboardPage() {
  const navigate = useNavigate();
  const { client, status } = useMatrixClient();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    if (!client) {
      navigate("/");
      return;
    }
    client.getAgents().then(setAgents);
    client.getSessions().then(setSessions);
  }, [client, navigate]);

  const handleCreateSession = async () => {
    if (!client || !selectedAgent || !cwd) return;
    setCreating(true);
    try {
      const session = await client.createSession({ agentId: selectedAgent, cwd });
      navigate(`/session/${session.sessionId}`);
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page-container">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Matrix Dashboard</h1>
        <span style={{
          padding: "4px 12px",
          borderRadius: 12,
          background: status === "connected" ? "#22c55e" : "#ef4444",
          color: "white",
          fontSize: 14,
        }}>
          {status}
        </span>
      </header>

      <section style={{ marginTop: 24 }}>
        <h2>Agents</h2>
        {agents.length === 0 ? (
          <p>No agents configured</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {agents.map((agent) => (
              <li key={agent.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee" }}>
                <strong>{agent.name}</strong> ({agent.command}) —{" "}
                {agent.available ? "Available" : "Unavailable"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>New Session</h2>
        <div className="dashboard-new-session" style={{ display: "flex", gap: 8, alignItems: "end" }}>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            style={{ padding: 8, flex: 1 }}
          >
            <option value="">Select an agent...</option>
            {agents.filter((a) => a.available).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="Working directory"
            style={{ padding: 8, flex: 2 }}
          />
          <button
            onClick={handleCreateSession}
            disabled={creating || !selectedAgent || !cwd}
            style={{ padding: "8px 16px", cursor: "pointer" }}
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Active Sessions</h2>
        {sessions.filter((s) => s.status === "active").length === 0 ? (
          <p>No active sessions</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {sessions.filter((s) => s.status === "active").map((s) => (
              <li
                key={s.sessionId}
                onClick={() => navigate(`/session/${s.sessionId}`)}
                style={{ padding: 12, borderBottom: "1px solid #eee", cursor: "pointer" }}
              >
                <strong>{s.agentId}</strong> — {s.cwd} — {s.createdAt}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
