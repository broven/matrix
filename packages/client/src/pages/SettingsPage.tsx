import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { AgentListItem, RepositoryInfo, ServerConfig } from "@matrix/protocol";
import { ShareServerModal } from "@/components/ShareServerModal";
import { FileExplorerDialog } from "@/components/repository/FileExplorerDialog";
import { Button } from "@/components/ui/button";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useServerStore } from "@/hooks/useServerStore";
import { SettingsGeneralTab } from "@/pages/settings/SettingsGeneralTab";
import { SettingsRepositoryTab } from "@/pages/settings/SettingsRepositoryTab";
import { SettingsSidebar, type SettingsTab } from "@/pages/settings/SettingsSidebar";

interface SettingsPageProps {
  onBack: () => void;
  repositories: RepositoryInfo[];
  onDeleteRepository: (repositoryId: string, deleteSource: boolean) => Promise<void> | void;
}

export function SettingsPage({ onBack, repositories, onDeleteRepository }: SettingsPageProps) {
  const { client, connect, connectionInfo, status } = useMatrixClient();
  const { servers, addServer, removeServer } = useServerStore();
  const {
    state: updateState,
    updateInfo,
    checkForUpdate,
    error: updateError,
    hasChecked,
    channel,
    setChannel,
  } = useAutoUpdate();
  const [selectedTab, setSelectedTab] = useState<SettingsTab>({ kind: "general" });
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newName, setNewName] = useState("");
  const [shareServer, setShareServer] = useState<{
    serverUrl: string;
    token: string;
    name?: string;
  } | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [browsePath, setBrowsePath] = useState<{ field: "reposPath" | "worktreesPath" } | null>(null);
  const [agents, setAgents] = useState<AgentListItem[]>([]);

  useEffect(() => {
    if (!client) return;

    setConfigLoading(true);
    Promise.all([
      client.getServerConfig(),
      client.getAgents(),
    ])
      .then(([config, agentList]) => {
        setServerConfig(config);
        setAgents(agentList);
      })
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, [client]);

  useEffect(() => {
    if (
      selectedTab.kind === "repository" &&
      !repositories.some((repository) => repository.id === selectedTab.repositoryId)
    ) {
      setSelectedTab({ kind: "general" });
    }
  }, [repositories, selectedTab]);

  const selectedRepository = useMemo(
    () =>
      selectedTab.kind === "repository"
        ? repositories.find((repository) => repository.id === selectedTab.repositoryId) ?? null
        : null,
    [repositories, selectedTab],
  );

  const handleSaveConfig = async (updates: Partial<ServerConfig>) => {
    if (!client) return;

    setConfigSaving(true);
    try {
      const updated = await client.updateServerConfig(updates);
      setServerConfig(updated);
    } catch (error) {
      console.error("Failed to save server config:", error);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleAddServer = () => {
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

  const handleConnectServer = (server: { serverUrl: string; token: string; id?: string }) => {
    connect(
      { serverUrl: server.serverUrl, token: server.token },
      { source: "saved", serverId: server.id },
    );
  };

  const handleDeleteSelectedRepository = async (repositoryId: string, deleteSource: boolean) => {
    await onDeleteRepository(repositoryId, deleteSource);
    setSelectedTab({ kind: "general" });
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-background" data-testid="settings-overlay">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back">
              <ArrowLeft className="size-4" />
            </Button>
            <h2 className="text-lg font-semibold">Settings</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Close settings">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <SettingsSidebar
            repositories={repositories}
            selectedTab={selectedTab}
            onSelectTab={setSelectedTab}
          />

          <div className="min-h-0 flex-1 overflow-y-auto bg-background">
            {selectedRepository ? (
              <SettingsRepositoryTab
                key={selectedRepository.id}
                repository={selectedRepository}
                onDeleteRepository={handleDeleteSelectedRepository}
              />
            ) : (
              <SettingsGeneralTab
                connectionInfo={connectionInfo}
                status={status}
                updateState={updateState}
                updateInfo={updateInfo ? { version: updateInfo.version } : null}
                checkForUpdate={checkForUpdate}
                updateError={updateError}
                hasChecked={hasChecked}
                channel={channel}
                setChannel={setChannel}
                onShareConnection={() => {
                  if (!connectionInfo) return;
                  setShareServer({
                    serverUrl: connectionInfo.serverUrl,
                    token: connectionInfo.token,
                  });
                }}
                clientAvailable={client !== null}
                serverConfig={serverConfig}
                configLoading={configLoading}
                configSaving={configSaving}
                onSetServerConfig={setServerConfig}
                onBrowsePath={(field) => setBrowsePath({ field })}
                onSaveConfig={() => {
                  if (serverConfig) {
                    void handleSaveConfig(serverConfig);
                  }
                }}
                servers={servers}
                onConnectServer={handleConnectServer}
                onShareServer={(server) => setShareServer(server)}
                onRemoveServer={removeServer}
                newName={newName}
                newUrl={newUrl}
                newToken={newToken}
                onNewNameChange={setNewName}
                onNewUrlChange={setNewUrl}
                onNewTokenChange={setNewToken}
                onAddServer={handleAddServer}
              />
            )}
          </div>
        </div>
      </div>

      {browsePath && client && (
        <FileExplorerDialog
          client={client}
          initialPath={serverConfig?.[browsePath.field]}
          onSelect={(path) => {
            if (serverConfig) {
              setServerConfig({ ...serverConfig, [browsePath.field]: path });
            }
            setBrowsePath(null);
          }}
          onClose={() => setBrowsePath(null)}
        />
      )}

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
