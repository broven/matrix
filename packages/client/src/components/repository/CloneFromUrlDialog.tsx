import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PathInput } from "@/components/ui/path-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BranchSelect } from "@/components/ui/branch-select";
import { X, ChevronRight, ChevronDown, Loader2, AlertTriangle, FolderOpen, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MatrixClient } from "@matrix/sdk";
import { parseRepoName } from "@matrix/protocol";
import type { CloneWarning, CloneConflict } from "@matrix/protocol";

interface CloneFromUrlDialogProps {
  client: MatrixClient;
  onCloneStarted: (jobId: string, repoName: string) => void;
  onOpenRepository?: (repositoryId: string) => void;
  onClose: () => void;
}

type ValidationState =
  | { type: "idle" }
  | { type: "validating" }
  | { type: "warning"; warning: CloneWarning }
  | { type: "conflict"; conflict: CloneConflict };

export function CloneFromUrlDialog({ client, onCloneStarted, onOpenRepository, onClose }: CloneFromUrlDialogProps) {
  const [url, setUrl] = useState("");
  const [targetDir, setTargetDir] = useState("");
  const [branch, setBranch] = useState("");
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dirManuallyEdited, setDirManuallyEdited] = useState(false);
  const [validationState, setValidationState] = useState<ValidationState>({ type: "idle" });

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setValidationState({ type: "idle" });
    if (!dirManuallyEdited) {
      setTargetDir(value.trim() ? parseRepoName(value.trim()) : "");
    }
  };

  const buildRequest = () => ({
    url: url.trim(),
    targetDir: targetDir.trim() || undefined,
    branch: branch.trim() || undefined,
  });

  const doClone = async () => {
    setCloning(true);
    setError(null);
    try {
      const { jobId } = await client.cloneRepository(buildRequest());
      onCloneStarted(jobId, targetDir.trim() || parseRepoName(url.trim()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone repository");
    } finally {
      setCloning(false);
    }
  };

  const handleClone = async () => {
    if (!url.trim()) return;

    // If user already confirmed a warning, proceed directly
    if (validationState.type === "warning") {
      await doClone();
      return;
    }

    setValidationState({ type: "validating" });
    setError(null);

    try {
      const result = await client.validateCloneRepository(buildRequest());

      // Conflict takes priority
      if (result.conflicts.length > 0) {
        setValidationState({ type: "conflict", conflict: result.conflicts[0] });
        return;
      }

      // Warning: show and wait for user confirmation
      if (result.warnings.length > 0) {
        setValidationState({ type: "warning", warning: result.warnings[0] });
        return;
      }

      // No issues — proceed with clone
      setValidationState({ type: "idle" });
      await doClone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
      setValidationState({ type: "idle" });
    }
  };

  const handleAddExisting = async (conflict: CloneConflict) => {
    setCloning(true);
    setError(null);
    try {
      const repo = await client.addRepository({ path: conflict.targetDir });
      onOpenRepository?.(repo.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add repository");
    } finally {
      setCloning(false);
    }
  };

  const handleOpenExisting = (conflict: CloneConflict) => {
    if (conflict.existingRepository) {
      onOpenRepository?.(conflict.existingRepository.id);
      onClose();
    }
  };

  const renderValidationMessage = () => {
    if (validationState.type === "warning") {
      const { warning } = validationState;
      return (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm" data-testid="clone-warning">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-500" />
            <div>
              <p className="font-medium text-yellow-500">{warning.message}</p>
              <p className="mt-1 text-muted-foreground">You can still clone to a different directory.</p>
            </div>
          </div>
        </div>
      );
    }

    if (validationState.type === "conflict") {
      const { conflict } = validationState;

      if (!conflict.isGitRepo) {
        return (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" data-testid="clone-conflict">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <p className="text-destructive">Target path is occupied by a non-git folder. Please choose a different directory.</p>
            </div>
          </div>
        );
      }

      if (conflict.alreadyAdded && conflict.existingRepository) {
        return (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm" data-testid="clone-conflict">
            <div className="flex items-start gap-2">
              <FolderOpen className="mt-0.5 size-4 shrink-0 text-blue-500" />
              <div>
                <p className="font-medium text-blue-500">This repository is already in Matrix.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => handleOpenExisting(conflict)}
                  data-testid="clone-open-existing-btn"
                >
                  <FolderOpen className="mr-1.5 size-3.5" />
                  Open Repository
                </Button>
              </div>
            </div>
          </div>
        );
      }

      // isGitRepo but not added
      return (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm" data-testid="clone-conflict">
          <div className="flex items-start gap-2">
            <Plus className="mt-0.5 size-4 shrink-0 text-blue-500" />
            <div>
              <p className="font-medium text-blue-500">A git repository already exists at the target path.</p>
              <p className="mt-1 text-muted-foreground">Would you like to add it to Matrix instead?</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={cloning}
                onClick={() => handleAddExisting(conflict)}
                data-testid="clone-add-existing-btn"
              >
                {cloning ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Plus className="mr-1.5 size-3.5" />}
                Add to Matrix
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const isConflict = validationState.type === "conflict";
  const isValidating = validationState.type === "validating";
  const isWarningConfirm = validationState.type === "warning";

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
                    onChange={(v) => { setTargetDir(v); setDirManuallyEdited(true); setValidationState({ type: "idle" }); }}
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
                  <BranchSelect
                    remoteUrl={url.trim() || undefined}
                    client={client}
                    value={branch}
                    onChange={(v) => { setBranch(v); setValidationState({ type: "idle" }); }}
                    placeholder="Default branch"
                    data-testid="clone-branch-select"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {renderValidationMessage()}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>
              Cancel
            </Button>
            {!isConflict && (
              <Button
                size="sm"
                className="rounded-lg"
                disabled={cloning || isValidating || !url.trim()}
                onClick={handleClone}
                data-testid="clone-submit-btn"
              >
                {(cloning || isValidating) ? (
                  <>
                    <Loader2 className={cn("size-4 animate-spin", "mr-1.5")} />
                    {isValidating ? "Checking..." : "Cloning..."}
                  </>
                ) : isWarningConfirm ? (
                  "Clone Anyway"
                ) : (
                  "Clone"
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
