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

export type UpdateChannel = "stable" | "beta";

export interface AutoUpdateContext {
  state: UpdateState;
  updateInfo: UpdateInfo | null;
  progress: DownloadProgress;
  error: string | null;
  hasChecked: boolean;
  channel: UpdateChannel;
  setChannel: (channel: UpdateChannel) => void;
  checkForUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
}

const INITIAL_DELAY = 2 * 60 * 1000; // 2 minutes after launch
const CHECK_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours

const CHANNEL_STORAGE_KEY = "matrix:update-channel";

let channelStore: any = null;

async function getChannelStore() {
  if (channelStore) return channelStore;
  if (!isTauri()) return null;
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    channelStore = new LazyStore("settings.json");
    return channelStore;
  } catch {
    return null;
  }
}

async function loadChannel(): Promise<UpdateChannel> {
  try {
    const store = await getChannelStore();
    if (store) {
      const val: string | undefined = await store.get(CHANNEL_STORAGE_KEY);
      if (val === "beta") return "beta";
    }
  } catch {
    // Fall through to default
  }
  return "stable";
}

async function persistChannel(channel: UpdateChannel): Promise<void> {
  try {
    const store = await getChannelStore();
    if (store) {
      await store.set(CHANNEL_STORAGE_KEY, channel);
    }
  } catch {
    // Silently ignore persistence failures
  }
}

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
  const [channel, setChannelState] = useState<UpdateChannel>("stable");
  const [channelLoaded, setChannelLoaded] = useState(false);
  const dismissedVersion = useRef<string | null>(null);
  const stateRef = useRef<UpdateState>("idle");

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Load channel on mount
  useEffect(() => {
    loadChannel().then((ch) => {
      setChannelState(ch);
      setChannelLoaded(true);
    });
  }, []);

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
      }>("check_update", { channel });

      setHasChecked(true);

      if (result.has_update && result.download_url) {
        // If we already show an available update, only replace if this is a newer version
        if (current === "available" && updateInfo && result.version === updateInfo.version) {
          setState("available"); // no change, restore state from "checking"
          return;
        }
        if (dismissedVersion.current === result.version) {
          setState(current === "available" ? "available" : "idle");
          return;
        }
        // New or newer version found — reset dismiss and show it
        dismissedVersion.current = null;
        setUpdateInfo({
          version: result.version,
          downloadUrl: result.download_url,
          releaseNotes: result.release_notes,
        });
        setState("available");
      } else {
        setState(current === "available" ? "available" : "idle");
      }
    } catch (e) {
      setHasChecked(true);
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }, [channel]);

  const setChannel = useCallback((ch: UpdateChannel) => {
    setChannelState(ch);
    persistChannel(ch);
    // The useEffect watching [checkForUpdate] will re-check automatically
    // since channel change recreates checkForUpdate
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
        (event: { payload: DownloadProgress }) => {
          setProgress(event.payload);
        }
      );
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  // Auto-check: 2min after launch, then every 3 hours (only after channel is loaded)
  useEffect(() => {
    if (!isTauri() || !isMacOS() || !channelLoaded) return;

    const initialTimer = setTimeout(() => {
      checkForUpdate();
    }, INITIAL_DELAY);

    const interval = setInterval(checkForUpdate, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [checkForUpdate, channelLoaded]);

  return {
    state,
    updateInfo,
    progress,
    error,
    hasChecked,
    channel,
    setChannel,
    checkForUpdate,
    downloadUpdate,
    installUpdate,
    dismiss,
  };
}
