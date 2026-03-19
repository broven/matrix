import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2, Wifi, RefreshCw, Info, Share2, Server, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useServerStore } from "@/hooks/useServerStore";
import { hasLocalServer, isTauri, isMacOS, isMobilePlatform } from "@/lib/platform";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { ShareServerModal } from "@/components/ShareServerModal";
import { FileExplorerDialog } from "@/components/repository/FileExplorerDialog";
import type { ServerConfig } from "@matrix/protocol";

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const { client, connect, connectionInfo, status } = useMatrixClient();
  const { servers, addServer, removeServer } = useServerStore();
  const { state: updateState, updateInfo, checkForUpdate, error: updateError, hasChecked, channel, setChannel } = useAutoUpdate();
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newName, setNewName] = useState("");
  const [shareServer, setShareServer] = useState<{
    serverUrl: string;
    token: string;
    name?: string;
  } | null>(null);

  // Server config state
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [browsePath, setBrowsePath] = useState<{ field: "reposPath" | "worktreesPath" } | null>(null);

  useEffect(() => {
    if (!client) return;
    setConfigLoading(true);
    client.getServerConfig()
      .then(setServerConfig)
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, [client]);

  const handleSaveConfig = async (updates: Partial<ServerConfig>) => {
    if (!client) return;
    setConfigSaving(true);
    try {
      const updated = await client.updateServerConfig(updates);
      setServerConfig(updated);
    } catch (err) {
      console.error("Failed to save server config:", err);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleAdd = () => {
    if (!newUrl || !newToken) return;
    let hostLabel: string;
    try {
      hostLabel = new URL(newUrl).host;
    } catch {
      hostLabel = newUrl;
    }
    addServer({
      serverUrl: newUrl,
      token: newToken,
      name: newName || hostLabel,
    });
    setNewUrl("");
    setNewToken("");
    setNewName("");
  };

  const handleConnect = (server: { serverUrl: string; token: string; id?: string }) => {
    connect(
      { serverUrl: server.serverUrl, token: server.token },
      { source: "saved", serverId: server.id }
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="text-lg font-semibold">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Current connection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi className="size-4" />
              Current Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <div>Server: {connectionInfo?.serverUrl ?? "-"}</div>
            <div>Status: {status}</div>
            {hasLocalServer() && connectionInfo?.serverUrl && /localhost:19880|127\.0\.0\.1:19880/.test(connectionInfo.serverUrl) && (
              <div className="text-xs text-primary">Local server (sidecar)</div>
            )}
            {connectionInfo && !isMobilePlatform() && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setShareServer({
                    serverUrl: connectionInfo.serverUrl,
                    token: connectionInfo.token,
                  })
                }
              >
                <Share2 className="mr-1.5 size-3.5" />
                Share Connection
              </Button>
            )}
          </CardContent>
        </Card>

        {/* App info & updates */}
        {isTauri() && isMacOS() && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="size-4" />
                About
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div className="text-muted-foreground">
                Version: {__APP_VERSION__}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <label htmlFor="update-channel">Update Channel:</label>
                <select
                  id="update-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as "stable" | "beta")}
                  className="rounded border bg-background px-2 py-1 text-sm"
                >
                  <option value="stable">Stable</option>
                  <option value="beta">Beta</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={checkForUpdate}
                  disabled={updateState === "checking"}
                >
                  <RefreshCw className={`mr-1.5 size-3.5 ${updateState === "checking" ? "animate-spin" : ""}`} />
                  Check for Updates
                </Button>
                {updateState === "available" && updateInfo && (
                  <span className="text-xs text-primary">
                    v{updateInfo.version} available
                  </span>
                )}
                {updateState === "checking" && (
                  <span className="text-xs text-muted-foreground">
                    Checking...
                  </span>
                )}
                {updateState === "idle" && !updateError && hasChecked && (
                  <span className="text-xs text-muted-foreground">
                    Up to date
                  </span>
                )}
              </div>
              {updateError && (
                <p className="text-xs text-destructive">{updateError}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Server Configuration */}
        {client && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="size-4" />
                Server Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {configLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading...
                </div>
              ) : serverConfig ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Repos Path
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={serverConfig.reposPath}
                        onChange={(e) => setServerConfig({ ...serverConfig, reposPath: e.target.value })}
                        placeholder="~/Projects/repos"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setBrowsePath({ field: "reposPath" })}
                      >
                        <FolderOpen className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Worktrees Path
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={serverConfig.worktreesPath}
                        onChange={(e) => setServerConfig({ ...serverConfig, worktreesPath: e.target.value })}
                        placeholder="~/Projects/worktrees"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setBrowsePath({ field: "worktreesPath" })}
                      >
                        <FolderOpen className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSaveConfig(serverConfig)}
                    disabled={configSaving}
                  >
                    {configSaving ? "Saving..." : "Save"}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Unable to load configuration</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Remote servers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Remote Servers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {servers.map((server) => (
              <div key={server.id} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{server.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{server.serverUrl}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleConnect(server)}>
                  Connect
                </Button>
                {!isMobilePlatform() && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setShareServer({
                        serverUrl: server.serverUrl,
                        token: server.token,
                        name: server.name,
                      })
                    }
                  >
                    <Share2 className="size-3.5" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => removeServer(server.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            <div className="space-y-3 pt-2 border-t">
              <Input
                placeholder="Server name (optional)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input
                placeholder="Server URL (https://...)"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Access token"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
              />
              <Button onClick={handleAdd} disabled={!newUrl || !newToken} className="w-full">
                <Plus className="size-4 mr-2" /> Add Remote Server
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* File browser for server config */}
      {browsePath && client && (
        <FileExplorerDialog
          client={client}
          initialPath={serverConfig?.[browsePath.field]}
          onSelect={(path) => {
            if (serverConfig) {
              const updated = { ...serverConfig, [browsePath.field]: path };
              setServerConfig(updated);
            }
            setBrowsePath(null);
          }}
          onClose={() => setBrowsePath(null)}
        />
      )}

      {/* Share modal */}
      <ShareServerModal
        open={shareServer !== null}
        onOpenChange={(open) => {
          if (!open) setShareServer(null);
        }}
        serverUrl={shareServer?.serverUrl ?? ""}
        token={shareServer?.token ?? ""}
        serverName={shareServer?.name}
      />
    </div>
  );
}
