import { X, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UpdateState, UpdateInfo, DownloadProgress } from "@/hooks/useAutoUpdate";

interface UpdateToastProps {
  state: UpdateState;
  updateInfo: UpdateInfo | null;
  progress: DownloadProgress;
  error: string | null;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateToast({
  state,
  updateInfo,
  progress,
  error,
  onDownload,
  onInstall,
  onDismiss,
}: UpdateToastProps) {
  if (state === "idle" || state === "checking") return null;

  const percent =
    progress.total > 0
      ? Math.round((progress.downloaded / progress.total) * 100)
      : 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-card p-4 shadow-lg animate-in slide-in-from-bottom-4 fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {state === "available" && updateInfo && (
            <>
              <p className="text-sm font-medium">
                v{updateInfo.version} available
              </p>
              {updateInfo.releaseNotes && (
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {updateInfo.releaseNotes}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={onDismiss}>
                  Later
                </Button>
                <Button size="sm" onClick={onDownload}>
                  <Download className="mr-1.5 size-3.5" />
                  Update
                </Button>
              </div>
            </>
          )}

          {state === "downloading" && (
            <>
              <p className="text-sm font-medium">Downloading update...</p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{percent}%</p>
            </>
          )}

          {state === "ready" && (
            <>
              <p className="text-sm font-medium">Update ready to install</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The app will restart to apply the update.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={onDismiss}>
                  Later
                </Button>
                <Button size="sm" onClick={onInstall}>
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Install Now
                </Button>
              </div>
            </>
          )}

          {state === "installing" && (
            <p className="text-sm font-medium">Installing update...</p>
          )}
        </div>

        {(state === "available" || state === "ready") && (
          <button
            onClick={onDismiss}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
