import { Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isMobilePlatform, isTauri } from "@/lib/platform";

interface SettingsGeneralTabProps {
  updateState: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
  updateInfo: { version: string } | null;
  checkForUpdate: () => void;
  updateError: string | null;
  hasChecked: boolean;
  channel: "stable" | "beta";
  setChannel: (channel: "stable" | "beta") => void;
}

export function SettingsGeneralTab({
  updateState,
  updateInfo,
  checkForUpdate,
  updateError,
  hasChecked,
  channel,
  setChannel,
}: SettingsGeneralTabProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
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
    </div>
  );
}
