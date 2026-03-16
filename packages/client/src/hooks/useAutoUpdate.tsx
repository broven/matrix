import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { isTauri, isMacOS } from "@/lib/platform";

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing";

export interface UpdateInfo {
  version: string;
  downloadUrl: string;
  releaseNotes: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

export interface AutoUpdateContext {
  state: UpdateState;
  updateInfo: UpdateInfo | null;
  progress: DownloadProgress;
  error: string | null;
  hasChecked: boolean;
  checkForUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
}

const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

const UpdateContext = createContext<AutoUpdateContext | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const value = useAutoUpdateInternal();
  return (
    <UpdateContext.Provider value={value}>
      {children}
    </UpdateContext.Provider>
  );
}

export function useAutoUpdate(): AutoUpdateContext {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error("useAutoUpdate must be used within an UpdateProvider");
  }
  return ctx;
}

function useAutoUpdateInternal(): AutoUpdateContext {
  const [state, setState] = useState<UpdateState>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [dmgPath, setDmgPath] = useState<string | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const dismissedVersion = useRef<string | null>(null);
  const stateRef = useRef<UpdateState>("idle");

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const checkForUpdate = useCallback(async () => {
    if (!isTauri() || !isMacOS()) return;

    // Don't interrupt download, ready, or installing states
    const current = stateRef.current;
    if (current === "downloading" || current === "ready" || current === "installing") return;

    try {
      setState("checking");
      setError(null);
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{
        has_update: boolean;
        version: string;
        download_url: string;
        release_notes: string;
      }>("check_update");

      setHasChecked(true);

      if (result.has_update && result.download_url) {
        if (dismissedVersion.current === result.version) {
          setState("idle");
          return;
        }
        setUpdateInfo({
          version: result.version,
          downloadUrl: result.download_url,
          releaseNotes: result.release_notes,
        });
        setState("available");
      } else {
        setState("idle");
      }
    } catch (e) {
      setHasChecked(true);
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }, []);

  const downloadUpdate = useCallback(async () => {
    if (!updateInfo) return;
    try {
      setState("downloading");
      setError(null);
      setProgress({ downloaded: 0, total: 0 });

      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string>("download_update", {
        url: updateInfo.downloadUrl,
      });
      setDmgPath(path);
      setState("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("available");
    }
  }, [updateInfo]);

  const installUpdate = useCallback(async () => {
    if (!dmgPath) return;
    try {
      setState("installing");
      setError(null);
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_update", { dmgPath });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("ready");
    }
  }, [dmgPath]);

  const dismiss = useCallback(() => {
    if (stateRef.current === "available" && updateInfo) {
      // Dismissing an available update: suppress for this check cycle
      dismissedVersion.current = updateInfo.version;
      setState("idle");
    } else if (stateRef.current === "ready") {
      // Dismissing a ready-to-install update: just hide toast, keep dmgPath
      // so the next check can re-show the install prompt
      setState("idle");
    } else {
      setState("idle");
    }
  }, [updateInfo]);

  // Listen for download progress events
  useEffect(() => {
    if (!isTauri() || !isMacOS()) return;
    let unlisten: (() => void) | undefined;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<DownloadProgress>(
        "update-download-progress",
        (event) => {
          setProgress(event.payload);
        }
      );
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  // Auto-check on mount + interval
  useEffect(() => {
    if (!isTauri() || !isMacOS()) return;

    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkForUpdate]);

  return {
    state,
    updateInfo,
    progress,
    error,
    hasChecked,
    checkForUpdate,
    downloadUpdate,
    installUpdate,
    dismiss,
  };
}
