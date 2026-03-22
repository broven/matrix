import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { RepositoryInfo } from "@matrix/protocol";
import { Button } from "@/components/ui/button";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useMatrixClient } from "@/hooks/useMatrixClient";
import { useServerStore } from "@/hooks/useServerStore";
import { useMatrixClients } from "@/hooks/useMatrixClients";
import { SettingsGeneralTab } from "@/pages/settings/SettingsGeneralTab";
import { SettingsRepositoryTab } from "@/pages/settings/SettingsRepositoryTab";
import { SettingsServerTab } from "@/pages/settings/SettingsServerTab";
import { SettingsNewServerTab } from "@/pages/settings/SettingsNewServerTab";
import { SettingsSidebar, type SettingsTab } from "@/pages/settings/SettingsSidebar";

const SIDECAR_SERVER_ID = "__sidecar__";

interface SettingsPageProps {
  onBack: () => void;
  repositories: RepositoryInfo[];
  onDeleteRepository: (repositoryId: string, deleteSource: boolean) => Promise<void> | void;
}

export function SettingsPage({ onBack, repositories, onDeleteRepository }: SettingsPageProps) {
  const { servers } = useServerStore();
  const { statuses } = useMatrixClients();
  const { status: sidecarStatus, connectionInfo } = useMatrixClient();

  // Prepend sidecar as "Local" server entry
  const allSettingsServers = useMemo(() => {
    const sidecarEntry = {
      id: SIDECAR_SERVER_ID,
      name: "Local",
      serverUrl: connectionInfo?.serverUrl ?? "",
      token: connectionInfo?.token ?? "",
      lastConnected: null as number | null,
    };
    return [sidecarEntry, ...servers];
  }, [servers, connectionInfo]);
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

  const selectedRepo = selectedTab.kind === "repository"
    ? repositories.find((r) => r.id === selectedTab.repositoryId)
    : null;

  const selectedServer = selectedTab.kind === "server"
    ? allSettingsServers.find((s) => s.id === selectedTab.serverId)
    : null;

  // Merge sidecar status into the statuses map for the sidebar
  const allStatuses = useMemo(() => {
    const merged = new Map(statuses);
    merged.set(SIDECAR_SERVER_ID, sidecarStatus);
    return merged;
  }, [statuses, sidecarStatus]);

  // If the selected repo/server was deleted, fall back to general
  useEffect(() => {
    if (selectedTab.kind === "repository" && !selectedRepo) {
      setSelectedTab({ kind: "general" });
    }
    if (selectedTab.kind === "server" && !selectedServer) {
      setSelectedTab({ kind: "general" });
    }
  }, [selectedTab, selectedRepo, selectedServer]);

  const handleDeleteSelectedRepository = async (repositoryId: string, deleteSource: boolean) => {
    await onDeleteRepository(repositoryId, deleteSource);
    setSelectedTab({ kind: "general" });
  };

  return (
    <div className="flex h-full flex-1 bg-background" data-testid="settings-overlay">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3 pt-10 md:px-6">
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
            servers={allSettingsServers}
            serverStatuses={allStatuses}
            selectedTab={selectedTab}
            onSelectTab={setSelectedTab}
          />

          <div className="min-h-0 flex-1 overflow-y-auto bg-background">
            {selectedTab.kind === "general" && (
              <SettingsGeneralTab
                updateState={updateState}
                updateInfo={updateInfo ? { version: updateInfo.version } : null}
                checkForUpdate={checkForUpdate}
                updateError={updateError}
                hasChecked={hasChecked}
                channel={channel}
                setChannel={setChannel}
              />
            )}
            {selectedTab.kind === "server" && selectedServer && (
              <SettingsServerTab key={selectedServer.id} server={selectedServer} />
            )}
            {selectedTab.kind === "new-server" && (
              <SettingsNewServerTab onCreated={setSelectedTab} />
            )}
            {selectedTab.kind === "repository" && selectedRepo && (
              <SettingsRepositoryTab
                key={selectedRepo.id}
                repository={selectedRepo}
                onDeleteRepository={handleDeleteSelectedRepository}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
