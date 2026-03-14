import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Wifi, ShieldCheck, QrCode } from "lucide-react";
import { useMatrixClient } from "../hooks/useMatrixClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function buildConnectionUri(serverUrl: string, token: string): string {
  const params = new URLSearchParams({ serverUrl, token });
  return `matrix://connect?${params.toString()}`;
}

function maskToken(token: string) {
  if (!token) return "-";
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function ConnectPage() {
  const { connect, status, connectionInfo, restoreLastConnection } = useMatrixClient();
  const [serverUrl, setServerUrl] = useState("http://localhost:8080");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    restoreLastConnection();
    const saved = sessionStorage.getItem("matrix:lastConnection");
    if (saved) {
      const { serverUrl: url, token: savedToken } = JSON.parse(saved) as {
        serverUrl: string;
        token: string;
      };
      setServerUrl(url);
      setToken(savedToken);
    }
  }, [restoreLastConnection]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramUrl = params.get("serverUrl");
    const paramToken = params.get("token");
    const autoConnect = params.get("autoConnect") === "1";

    if (paramUrl) setServerUrl(paramUrl);
    if (paramToken) setToken(paramToken);

    if (autoConnect && paramUrl && paramToken) {
      connect({ serverUrl: paramUrl, token: paramToken });
      // Clean URL after auto-connect
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [connect]);

  useEffect(() => {
    if (!serverUrl || !token) {
      setQrDataUrl("");
      return;
    }

    void QRCode.toDataURL(buildConnectionUri(serverUrl, token), {
      margin: 1,
      width: 224,
    }).then(setQrDataUrl);
  }, [serverUrl, token]);

  const handleConnect = () => {
    if (!serverUrl || !token) {
      setError("Server URL and token are required.");
      return;
    }

    setError("");
    connect({ serverUrl, token });
  };

  const connectionUri = serverUrl && token ? buildConnectionUri(serverUrl, token) : "";

  return (
    <div className="surface-grid relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_color-mix(in_oklch,var(--primary)_18%,transparent),transparent_35%),radial-gradient(circle_at_bottom_right,_color-mix(in_oklch,var(--warning)_20%,transparent),transparent_32%)]" />
      <div className="relative grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,420px)]">
        <Card className="border-border/70 bg-card/90 shadow-2xl shadow-primary/5 backdrop-blur">
          <CardHeader className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2">
                <Badge variant="outline" className="w-fit rounded-full px-3 py-1 uppercase tracking-[0.25em]">
                  Matrix
                </Badge>
                <CardTitle className="text-4xl font-semibold tracking-tight">
                  Connect to your ACP server.
                </CardTitle>
                <CardDescription className="max-w-xl text-base leading-7">
                  Pair this client with an existing Matrix backend, keep the session token local,
                  and jump straight into active agent sessions.
                </CardDescription>
              </div>
              <Badge
                variant={status === "connected" ? "default" : "secondary"}
                className="rounded-full px-3 py-1"
              >
                <Wifi className="mr-1 size-3.5" />
                {status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-5">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground" htmlFor="server-url">
                  Server URL
                </label>
                <Input
                  id="server-url"
                  type="url"
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                  placeholder="http://localhost:8080"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground" htmlFor="access-token">
                  Access Token
                </label>
                <Input
                  id="access-token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste your server token"
                />
              </div>

              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleConnect} disabled={status === "connecting"} size="lg">
                  {status === "connecting" ? "Connecting..." : "Connect"}
                </Button>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="size-4" />
                  Session details are restored locally from `sessionStorage`.
                </div>
              </div>

              <div className="grid gap-3 rounded-2xl border border-border/60 bg-muted/40 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="size-4 text-primary" />
                  Connection details
                </div>
                <div className="grid gap-2 text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Server:</span>{" "}
                    {connectionInfo?.serverUrl ?? serverUrl ?? "-"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Token:</span>{" "}
                    {connectionInfo?.tokenMasked ?? maskToken(token)}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Transport:</span>{" "}
                    {connectionInfo?.transport ?? "auto"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Source:</span>{" "}
                    {connectionInfo?.source ?? "manual"}
                  </div>
                </div>
              </div>
            </div>

            <Card className="border-border/60 bg-background/80 shadow-none">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <QrCode className="size-4 text-primary" />
                  Connection QR
                </CardTitle>
                <CardDescription>
                  Scan from another Matrix client or copy the deep link below.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border bg-muted/40 p-4">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Connection QR"
                      width={224}
                      height={224}
                      className="rounded-xl"
                    />
                  ) : (
                    <p className="max-w-48 text-center text-sm text-muted-foreground">
                      Enter both values to generate a QR code for this connection.
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    Deep Link
                  </label>
                  <Input readOnly value={connectionUri} className="font-mono text-xs" />
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="border-border/60 bg-card/85 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg">What changes in the redesign</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>
                Desktop keeps sessions pinned in a sidebar. Mobile swaps that for a slide-out
                drawer so the message stream stays centered.
              </p>
              <p>
                The interface follows your system theme automatically and keeps code, diffs, and
                tool cards readable in both modes.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
