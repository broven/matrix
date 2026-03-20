import { FolderOpen, Info, Loader2, Plus, RefreshCw, Server, Share2, Trash2, Wifi } from "lucide-react";
import type { ServerConfig } from "@matrix/protocol";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { hasLocalServer, isMacOS, isMobilePlatform, isTauri } from "@/lib/platform";

interface SavedServer {
  id: string;
  name: string;
  serverUrl: string;
  token: string;
}

interface SettingsGeneralTabProps {
  connectionInfo: { serverUrl: string; token: string } | null;
  status: string;
  connectionError: string | null;
  updateState: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
  updateInfo: { version: string } | null;
  checkForUpdate: () => void;
  updateError: string | null;
  hasChecked: boolean;
  channel: "stable" | "beta";
  setChannel: (channel: "stable" | "beta") => void;
  onShareConnection: () => void;
  clientAvailable: boolean;
  serverConfig: ServerConfig | null;
  configLoading: boolean;
  configSaving: boolean;
  onSetServerConfig: (next: ServerConfig) => void;
  onBrowsePath: (field: "reposPath" | "worktreesPath") => void;
  onSaveConfig: () => void;
  servers: SavedServer[];
  onConnectServer: (server: { serverUrl: string; token: string; id?: string }) => void;
  onShareServer: (server: { serverUrl: string; token: string; name?: string }) => void;
  onRemoveServer: (id: string) => void;
  newName: string;
  newUrl: string;
  newToken: string;
  onNewNameChange: (value: string) => void;
  onNewUrlChange: (value: string) => void;
  onNewTokenChange: (value: string) => void;
  onAddServer: () => void;
}

export function SettingsGeneralTab({
  connectionInfo,
  status,
  connectionError,
  updateState,
  updateInfo,
  checkForUpdate,
  updateError,
  hasChecked,
  channel,
  setChannel,
  onShareConnection,
  clientAvailable,
  serverConfig,
  configLoading,
  configSaving,
  onSetServerConfig,
  onBrowsePath,
  onSaveConfig,
  servers,
  onConnectServer,
  onShareServer,
  onRemoveServer,
  newName,
  newUrl,
  newToken,
  onNewNameChange,
  onNewUrlChange,
  onNewTokenChange,
  onAddServer,
}: SettingsGeneralTabProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wifi className="size-4" />
            Current Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div>Server: {connectionInfo?.serverUrl ?? "-"}</div>
          <div>Status: {status}</div>
          {connectionError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {connectionError}
            </div>
          )}
          {hasLocalServer() && connectionInfo?.serverUrl && /localhost:19880|127\.0\.0\.1:19880/.test(connectionInfo.serverUrl) && (
            <div className="text-xs text-primary">Local server (sidecar)</div>
          )}
          {connectionInfo && !isMobilePlatform() && (
            <Button size="sm" variant="outline" onClick={onShareConnection}>
              <Share2 className="mr-1.5 size-3.5" />
              Share Connection
            </Button>
          )}
        </CardContent>
      </Card>

      {isTauri() && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4" />
              About
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-muted-foreground">Version: {__APP_VERSION__}</div>
            {!isMobilePlatform() && (
              <>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <label htmlFor="update-channel">Update Channel:</label>
                  <select
                    id="update-channel"
                    value={channel}
                    onChange={(event) => setChannel(event.target.value as "stable" | "beta")}
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
                    <span className="text-xs text-primary">v{updateInfo.version} available</span>
                  )}
                  {updateState === "checking" && (
                    <span className="text-xs text-muted-foreground">Checking...</span>
                  )}
                  {updateState === "idle" && !updateError && hasChecked && (
                    <span className="text-xs text-muted-foreground">Up to date</span>
                  )}
                </div>
                {updateError && <p className="text-xs text-destructive">{updateError}</p>}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {clientAvailable && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
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
                  <label className="mb-1.5 block text-sm font-medium">Repos Path</label>
                  <div className="flex gap-2">
                    <Input
                      value={serverConfig.reposPath}
                      onChange={(event) =>
                        onSetServerConfig({ ...serverConfig, reposPath: event.target.value })
                      }
                      placeholder="~/Projects/repos"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onBrowsePath("reposPath")}
                      aria-label="Browse repos path"
                    >
                      <FolderOpen className="size-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Worktrees Path</label>
                  <div className="flex gap-2">
                    <Input
                      value={serverConfig.worktreesPath}
                      onChange={(event) =>
                        onSetServerConfig({ ...serverConfig, worktreesPath: event.target.value })
                      }
                      placeholder="~/Projects/worktrees"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onBrowsePath("worktreesPath")}
                      aria-label="Browse worktrees path"
                    >
                      <FolderOpen className="size-4" />
                    </Button>
                  </div>
                </div>
                <Button size="sm" onClick={onSaveConfig} disabled={configSaving}>
                  {configSaving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Unable to load configuration</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Remote Servers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {servers.map((server) => (
            <div key={server.id} className="flex items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{server.name}</div>
                <div className="truncate text-xs text-muted-foreground">{server.serverUrl}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => onConnectServer(server)}>
                Connect
              </Button>
              {!isMobilePlatform() && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Share ${server.name}`}
                  onClick={() => onShareServer(server)}
                >
                  <Share2 className="size-3.5" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${server.name}`}
                onClick={() => onRemoveServer(server.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}

          <div className="space-y-3 border-t pt-2">
            <Input
              placeholder="Server name (optional)"
              value={newName}
              onChange={(event) => onNewNameChange(event.target.value)}
            />
            <Input
              placeholder="Server URL (https://...)"
              value={newUrl}
              onChange={(event) => onNewUrlChange(event.target.value)}
            />
            <Input
              type="password"
              placeholder="Access token"
              value={newToken}
              onChange={(event) => onNewTokenChange(event.target.value)}
            />
            <Button onClick={onAddServer} disabled={!newUrl || !newToken} className="w-full">
              <Plus className="mr-2 size-4" />
              Add Remote Server
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
