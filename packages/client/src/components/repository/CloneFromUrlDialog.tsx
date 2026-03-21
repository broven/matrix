import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PathInput } from "@/components/ui/path-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { X, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MatrixClient } from "@matrix/sdk";
import { parseRepoName } from "@matrix/protocol";

interface CloneFromUrlDialogProps {
  client: MatrixClient;
  onCloneStarted: (jobId: string, repoName: string) => void;
  onClose: () => void;
}

export function CloneFromUrlDialog({ client, onCloneStarted, onClose }: CloneFromUrlDialogProps) {
  const [url, setUrl] = useState("");
  const [targetDir, setTargetDir] = useState("");
  const [branch, setBranch] = useState("");
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dirManuallyEdited, setDirManuallyEdited] = useState(false);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (!dirManuallyEdited) {
      setTargetDir(value.trim() ? parseRepoName(value.trim()) : "");
    }
  };

  const handleClone = async () => {
    if (!url.trim()) return;

    setCloning(true);
    setError(null);
    try {
      const { jobId } = await client.cloneRepository({
        url: url.trim(),
        targetDir: targetDir.trim() || undefined,
        branch: branch.trim() || undefined,
      });
      onCloneStarted(jobId, targetDir.trim() || parseRepoName(url.trim()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone repository");
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4">
          <h2 className="text-lg font-semibold">Clone from URL</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Repository URL
            </label>
            <Input
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              className="rounded-lg"
              autoFocus
              data-testid="clone-url-input"
            />
          </div>

          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {showAdvanced ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Advanced options
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-3 pt-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Target directory
                  </label>
                  <PathInput
                    value={targetDir}
                    onChange={(v) => { setTargetDir(v); setDirManuallyEdited(true); }}
                    onBrowseSelect={() => { setDirManuallyEdited(true); }}
                    client={client}
                    placeholder="repo"
                    data-testid="clone-target-dir-input"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Branch <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="Default branch"
                    className="rounded-lg"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="rounded-lg"
              disabled={cloning || !url.trim()}
              onClick={handleClone}
              data-testid="clone-submit-btn"
            >
              {cloning ? (
                <>
                  <Loader2 className={cn("size-4 animate-spin", "mr-1.5")} />
                  Cloning...
                </>
              ) : (
                "Clone"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
