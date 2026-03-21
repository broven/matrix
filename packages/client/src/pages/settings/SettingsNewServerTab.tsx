import { useCallback, useState } from "react";
import { useServerStore } from "../../hooks/useServerStore";
import { useMatrixClients } from "../../hooks/useMatrixClients";
import type { SettingsTab } from "./SettingsSidebar";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface SettingsNewServerTabProps {
  onCreated: (tab: SettingsTab) => void;
}

export function SettingsNewServerTab({ onCreated }: SettingsNewServerTabProps) {
  const { addServer, servers } = useServerStore();
  const { connect } = useMatrixClients();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!url || !token) return;

    setTesting(true);
    setTestResult(null);
    setTestError(null);

    // Test connection by fetching auth info
    try {
      const testUrl = url.replace(/\/$/, "");
      const res = await fetch(`${testUrl}/api/auth-info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      setTestResult("success");

      // Save and connect
      const serverName = name || new URL(url).hostname;
      addServer({ name: serverName, serverUrl: url, token });

      // Find the newly added server (it's the last one with this URL)
      // We need to wait for state update, so use a small delay
      setTimeout(() => {
        // The server was just added — find it by URL
        const newServer = servers.find(s => s.serverUrl === url);
        if (newServer) {
          connect(newServer.id, { serverUrl: url, token });
          onCreated({ kind: "server", serverId: newServer.id });
        }
      }, 100);
    } catch (err) {
      setTestResult("error");
      setTestError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }, [name, url, token, addServer, connect, onCreated, servers]);

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="settings-new-server">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Server</CardTitle>
          <CardDescription>Connect to a Matrix server</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Name (optional)</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Server"
              data-testid="new-server-name-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Server URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.1.100:19880"
              data-testid="new-server-url-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Token</label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Server auth token"
              data-testid="new-server-token-input"
            />
          </div>

          {testResult === "success" && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="size-4" />
              Connected successfully
            </div>
          )}
          {testResult === "error" && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {testError}
            </div>
          )}

          <Button
            onClick={handleSave}
            disabled={!url || !token || testing}
            data-testid="new-server-save-btn"
          >
            {testing ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
            {testing ? "Testing connection..." : "Save & Connect"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
