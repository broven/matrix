import { useState } from "react";
import { ArrowLeft, Plus, Trash2, Wifi, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { hasLocalServer, isTauri, isMacOS } from "@/lib/platform";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";

interface SavedServer {
  serverUrl: string;
  token: string;
  name: string;
}

const STORAGE_KEY = "matrix:remoteServers";

function loadSavedServers(): SavedServer[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSavedServers(servers: SavedServer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const { connect, connectionInfo, status } = useMatrixClient();
  const { state: updateState, updateInfo, checkForUpdate, error: updateError, hasChecked } = useAutoUpdate();
  const [servers, setServers] = useState(loadSavedServers);
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newName, setNewName] = useState("");

  const handleAdd = () => {
    if (!newUrl || !newToken) return;
    let hostLabel: string;
    try {
      hostLabel = new URL(newUrl).host;
    } catch {
      hostLabel = newUrl;
    }
    const server: SavedServer = {
      serverUrl: newUrl,
      token: newToken,
      name: newName || hostLabel,
    };
    const updated = [...servers, server];
    setServers(updated);
    saveSavedServers(updated);
    setNewUrl("");
    setNewToken("");
    setNewName("");
  };

  const handleRemove = (index: number) => {
    const updated = servers.filter((_, i) => i !== index);
    setServers(updated);
    saveSavedServers(updated);
  };

  const handleConnect = (server: SavedServer) => {
    connect({ serverUrl: server.serverUrl, token: server.token });
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
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <div>Server: {connectionInfo?.serverUrl ?? "-"}</div>
            <div>Status: {status}</div>
            {hasLocalServer() && connectionInfo?.serverUrl?.includes("localhost:19880") && (
              <div className="text-xs text-primary">Local server (sidecar)</div>
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

        {/* Remote servers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Remote Servers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {servers.map((server, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{server.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{server.serverUrl}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleConnect(server)}>
                  Connect
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleRemove(i)}>
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
    </div>
  );
}
