import { useCallback, useEffect, useState } from "react";
import type { SavedServer } from "../../hooks/useServerStore";
import type { AgentListItem, ServerConfig } from "@matrix/protocol";
import { useServerClient } from "../../hooks/useMatrixClients";
import { useMatrixClients } from "../../hooks/useMatrixClients";
import { useMatrixClient } from "../../hooks/useMatrixClient";
import { useServerStore } from "../../hooks/useServerStore";
import { SettingsAgentsTab } from "./SettingsAgentsTab";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { AlertCircle, CheckCircle2, Loader2, Trash2, Unplug, Plug } from "lucide-react";

const SIDECAR_SERVER_ID = "__sidecar__";

interface SettingsServerTabProps {
  server: SavedServer;
}

export function SettingsServerTab({ server }: SettingsServerTabProps) {
  const isSidecar = server.id === SIDECAR_SERVER_ID;

  // For sidecar: use the single-client context. For remote: use multi-client.
  const sidecar = useMatrixClient();
  const remote = useServerClient(isSidecar ? "" : server.id);

  const client = isSidecar ? sidecar.client : remote.client;
  const status = isSidecar ? sidecar.status : remote.status;
  const error = isSidecar ? sidecar.error : remote.error;

  const { connect, disconnect } = useMatrixClients();
  const { updateServer, removeServer } = useServerStore();

  const [name, setName] = useState(server.name);
  const [url, setUrl] = useState(server.serverUrl);
  const [token, setToken] = useState(server.token);

  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [reposPath, setReposPath] = useState("");
  const [worktreesPath, setWorktreesPath] = useState("");

  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load server config and agents when connected
  useEffect(() => {
    if (status !== "connected" || !client) return;

    const load = async () => {
      setConfigLoading(true);
      try {
        const [config, agentList] = await Promise.all([
          client.getServerConfig(),
          client.getAgents(),
        ]);
        setServerConfig(config);
        setReposPath(config.reposPath);
        setWorktreesPath(config.worktreesPath);
        setAgents(agentList);
      } catch {
        // Silently fail — connection error will show in status
      } finally {
        setConfigLoading(false);
      }
    };
    load();
  }, [status, client]);

  // Auto-connect on mount if not connected (remote servers only)
  useEffect(() => {
    if (!isSidecar && (status === "offline" || !status)) {
      connect(server.id, { serverUrl: server.serverUrl, token: server.token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveConnection = useCallback(() => {
    updateServer(server.id, { name, serverUrl: url, token });
    // Reconnect with new credentials if they changed
    if (url !== server.serverUrl || token !== server.token) {
      disconnect(server.id);
      connect(server.id, { serverUrl: url, token });
    }
  }, [name, url, token, server, updateServer, disconnect, connect]);

  const handleSaveConfig = useCallback(async () => {
    if (!client) return;
    setConfigSaving(true);
    try {
      await client.updateServerConfig({
        reposPath,
        worktreesPath,
      });
      setServerConfig({ ...serverConfig!, reposPath, worktreesPath });
    } catch {
      // Error handling — could show toast
    } finally {
      setConfigSaving(false);
    }
  }, [client, reposPath, worktreesPath, serverConfig]);

  const handleDelete = useCallback(() => {
    disconnect(server.id);
    removeServer(server.id);
  }, [server.id, disconnect, removeServer]);

  const handleToggleConnection = useCallback(() => {
    if (status === "connected" || status === "connecting" || status === "reconnecting") {
      disconnect(server.id);
    } else {
      connect(server.id, { serverUrl: url, token });
    }
  }, [status, server.id, url, token, connect, disconnect]);

  const refreshAgents = useCallback(async () => {
    if (!client) return;
    try {
      const agentList = await client.getAgents();
      setAgents(agentList);
    } catch {
      // Silently fail
    }
  }, [client]);

  const isConnected = status === "connected";

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="settings-server-detail">
      {/* Connection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection</CardTitle>
          <CardDescription>Server connection details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            {status === "connected" ? (
              <CheckCircle2 className="size-4 text-green-500" />
            ) : status === "connecting" || status === "reconnecting" ? (
              <Loader2 className="size-4 animate-spin text-yellow-500" />
            ) : (
              <AlertCircle className="size-4 text-muted-foreground" />
            )}
            <span className="text-sm capitalize">{status ?? "offline"}</span>
            {!isSidecar && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleConnection}
                className="ml-auto"
                data-testid="server-toggle-connection-btn"
              >
                {isConnected ? <><Unplug className="mr-1 size-3.5" /> Disconnect</> : <><Plug className="mr-1 size-3.5" /> Connect</>}
              </Button>
            )}
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {isSidecar ? (
            <p className="text-xs text-muted-foreground">{server.serverUrl || "Built-in server"}</p>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="server-name-input" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">URL</label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} data-testid="server-url-input" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Token</label>
                <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} data-testid="server-token-input" />
              </div>
              <Button size="sm" onClick={handleSaveConnection} data-testid="server-save-connection-btn">
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Server Configuration Card */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Server Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {configLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <div>
                  <label className="text-xs text-muted-foreground">Repos Path</label>
                  <Input value={reposPath} onChange={(e) => setReposPath(e.target.value)} data-testid="server-repos-path-input" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Worktrees Path</label>
                  <Input value={worktreesPath} onChange={(e) => setWorktreesPath(e.target.value)} data-testid="server-worktrees-path-input" />
                </div>
                <Button size="sm" onClick={handleSaveConfig} disabled={configSaving} data-testid="server-save-config-btn">
                  {configSaving ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                  Save
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Agents */}
      {isConnected && client && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsAgentsTab agents={agents} onRefreshAgents={refreshAgents} embedded />
          </CardContent>
        </Card>
      )}

      {/* Danger Zone — remote servers only */}
      {!isSidecar && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">Remove this server?</span>
                <Button size="sm" variant="destructive" onClick={handleDelete} data-testid="server-confirm-delete-btn">
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setConfirmDelete(true)}
                data-testid="server-delete-btn"
              >
                <Trash2 className="mr-1 size-3.5" />
                Remove Server
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
