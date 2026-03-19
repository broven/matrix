import { useState, useEffect } from "react";
import {
  Wifi,
  WifiOff,
  Plus,
  Trash2,
  Share2,
  Loader2,
  ScanLine,
  Server,
  Pencil,
} from "lucide-react";
import { useMatrixClient } from "../hooks/useMatrixClient";
import { useServerStore, type SavedServer } from "../hooks/useServerStore";
import { hasLocalServer, isMobilePlatform, getLocalServerUrl } from "@/lib/platform";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShareServerModal } from "@/components/ShareServerModal";

type AddMode = "manual" | "scan" | null;

export function ConnectPage() {
  const { connect, status, connectionInfo, disconnect } = useMatrixClient();
  const { servers, addServer, removeServer } = useServerStore();

  // Add server form
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newName, setNewName] = useState("");

  // Local sidecar URL (may use a custom port in dev mode)
  const [localServerUrl, setLocalServerUrl] = useState("http://127.0.0.1:19880");
  useEffect(() => {
    if (hasLocalServer()) {
      getLocalServerUrl().then(setLocalServerUrl);
    }
  }, []);

  // Share modal
  const [shareServer, setShareServer] = useState<{
    serverUrl: string;
    token: string;
    name?: string;
  } | null>(null);

  const handleAddServer = () => {
    if (!newUrl || !newToken) return;
    let name = newName;
    if (!name) {
      try {
        name = new URL(newUrl).host;
      } catch {
        name = newUrl;
      }
    }
    addServer({ name, serverUrl: newUrl, token: newToken });
    setNewUrl("");
    setNewToken("");
    setNewName("");
    setAddMode(null);
  };

  const handleConnect = (server: SavedServer) => {
    connect(
      { serverUrl: server.serverUrl, token: server.token },
      { source: "saved", serverId: server.id }
    );
  };

  const handleConnectManual = () => {
    if (!newUrl || !newToken) return;
    // Also save to server store
    let name = newName;
    if (!name) {
      try {
        name = new URL(newUrl).host;
      } catch {
        name = newUrl;
      }
    }
    addServer({ name, serverUrl: newUrl, token: newToken });
    connect(
      { serverUrl: newUrl, token: newToken },
      { source: "manual" }
    );
    setNewUrl("");
    setNewToken("");
    setNewName("");
    setAddMode(null);
  };

  const isConnectedTo = (server: SavedServer) =>
    connectionInfo?.serverUrl === server.serverUrl && status === "connected";

  const isLocalConnected =
    connectionInfo?.serverUrl === localServerUrl && status === "connected";

  return (
    <div className="surface-grid relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_color-mix(in_oklch,var(--primary)_18%,transparent),transparent_35%),radial-gradient(circle_at_bottom_right,_color-mix(in_oklch,var(--warning)_20%,transparent),transparent_32%)]" />

      <div className="relative w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="space-y-2 text-center">
          <Badge
            variant="outline"
            className="mx-auto w-fit rounded-full px-3 py-1 uppercase tracking-[0.25em]"
          >
            Matrix
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight">Servers</h1>
          <p className="text-base text-muted-foreground">
            Manage your Matrix server connections.
          </p>
        </div>

        {/* Local sidecar server (Desktop only) */}
        {hasLocalServer() && (
          <Card className="border-border/70 bg-card/90 backdrop-blur">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Server className="size-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Local Server</span>
                  <Badge variant="secondary" className="text-xs">
                    sidecar
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {localServerUrl}
                </div>
              </div>
              <StatusBadge
                connected={isLocalConnected ?? false}
                connecting={
                  connectionInfo?.serverUrl === localServerUrl &&
                  status === "connecting"
                }
              />
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  // Fetch the real token from the local server
                  try {
                    const res = await fetch(`${localServerUrl}/api/auth-info`);
                    const { token: realToken } = await res.json() as { token: string };
                    setShareServer({
                      serverUrl: localServerUrl,
                      token: realToken,
                      name: "Local Server",
                    });
                  } catch {
                    setShareServer({
                      serverUrl: localServerUrl,
                      token: connectionInfo?.token ?? "",
                      name: "Local Server",
                    });
                  }
                }}
              >
                <Share2 className="size-3.5" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Saved servers */}
        {servers.length > 0 && (
          <Card className="border-border/70 bg-card/90 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Remote Servers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/50 p-3"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                    <Server className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {server.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {server.serverUrl}
                    </div>
                  </div>
                  <StatusBadge
                    connected={isConnectedTo(server)}
                    connecting={
                      connectionInfo?.serverUrl === server.serverUrl &&
                      status === "connecting"
                    }
                  />
                  <div className="flex items-center gap-1">
                    {!isConnectedTo(server) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleConnect(server)}
                      >
                        Connect
                      </Button>
                    )}
                    {isConnectedTo(server) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={disconnect}
                      >
                        Disconnect
                      </Button>
                    )}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeServer(server.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Add server */}
        <Card className="border-border/70 bg-card/90 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Add Server</CardTitle>
            <CardDescription>
              Connect to a remote Matrix server by entering its details or
              scanning a QR code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {addMode === null && (
              <div className="flex gap-3">
                <Button
                  onClick={() => setAddMode("manual")}
                  variant="outline"
                  className="flex-1"
                >
                  <Pencil className="mr-2 size-4" />
                  Manual Input
                </Button>
                {isMobilePlatform() && (
                  <Button
                    onClick={() => setAddMode("scan")}
                    variant="outline"
                    className="flex-1"
                  >
                    <ScanLine className="mr-2 size-4" />
                    Scan QR Code
                  </Button>
                )}
              </div>
            )}

            {addMode === "manual" && (
              <div className="space-y-3">
                <Input
                  placeholder="Server name (optional)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Input
                  placeholder="Server URL (https://...)"
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
                <Input
                  placeholder="Access token"
                  type="password"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleConnectManual}
                    disabled={!newUrl || !newToken}
                    className="flex-1"
                  >
                    <Plus className="mr-2 size-4" />
                    Add & Connect
                  </Button>
                  <Button
                    onClick={handleAddServer}
                    variant="outline"
                    disabled={!newUrl || !newToken}
                  >
                    Save Only
                  </Button>
                  <Button
                    onClick={() => setAddMode(null)}
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {addMode === "scan" && (
              <ScanQRView
                onResult={(url, token) => {
                  let name: string;
                  try {
                    name = new URL(url).host;
                  } catch {
                    name = url;
                  }
                  addServer({ name, serverUrl: url, token });
                  connect(
                    { serverUrl: url, token },
                    { source: "manual" }
                  );
                  setAddMode(null);
                }}
                onCancel={() => setAddMode(null)}
              />
            )}
          </CardContent>
        </Card>
      </div>

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

function StatusBadge({
  connected,
  connecting,
}: {
  connected: boolean;
  connecting?: boolean | null;
}) {
  if (connecting) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        Connecting
      </Badge>
    );
  }
  if (connected) {
    return (
      <Badge variant="default" className="gap-1">
        <Wifi className="size-3" />
        Online
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <WifiOff className="size-3" />
      Offline
    </Badge>
  );
}

function ScanQRView({
  onResult,
  onCancel,
}: {
  onResult: (serverUrl: string, token: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  const startScan = async () => {
    setScanning(true);
    setError("");
    try {
      const { scan, Format } = await import("@tauri-apps/plugin-barcode-scanner");
      const result = await scan({ formats: [Format.QRCode], windowed: false });

      // Parse matrix://connect?serverUrl=...&token=...
      const content = typeof result === "string" ? result : (result as any)?.content;
      if (!content) {
        setError("No QR code detected.");
        setScanning(false);
        return;
      }

      const url = new URL(content);
      if (url.protocol !== "matrix:" || url.pathname !== "//connect") {
        // Try parsing as matrix://connect?...
        const serverUrl = url.searchParams.get("serverUrl");
        const token = url.searchParams.get("token");
        if (serverUrl && token) {
          onResult(serverUrl, token);
          return;
        }
        setError("Invalid QR code format. Expected a Matrix connection QR.");
        setScanning(false);
        return;
      }

      const serverUrl = url.searchParams.get("serverUrl");
      const token = url.searchParams.get("token");
      if (!serverUrl || !token) {
        setError("QR code missing serverUrl or token.");
        setScanning(false);
        return;
      }

      onResult(serverUrl, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-muted-foreground">
        Point your camera at a Matrix server QR code.
      </p>
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-center">
        <Button onClick={startScan} disabled={scanning}>
          {scanning ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Scanning...
            </>
          ) : (
            <>
              <ScanLine className="mr-2 size-4" />
              Start Scan
            </>
          )}
        </Button>
        <Button onClick={onCancel} variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  );
}
