import { useState, useMemo } from "react";
import type { RepositoryInfo } from "@matrix/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { X, ChevronDown, ChevronRight } from "lucide-react";

interface NewWorktreeDialogProps {
  repository: RepositoryInfo;
  onCreateWorktree: (
    repoId: string,
    branch: string,
    baseBranch: string,
  ) => Promise<void>;
  onClose: () => void;
}

/** Validate branch name against git check-ref-format rules */
function validateBranchName(name: string): string | null {
  if (!name.trim()) return null; // empty is not an error, just not ready
  if (/\s/.test(name)) return "Branch name cannot contain spaces";
  if (/[~^:?*\[\\]/.test(name)) return "Branch name contains invalid characters";
  if (/\.\./.test(name)) return "Branch name cannot contain '..'";
  if (name.endsWith(".") || name.endsWith("/")) return "Branch name cannot end with '.' or '/'";
  if (name.startsWith("-")) return "Branch name cannot start with '-'";
  if (name.startsWith("/")) return "Branch name cannot start with '/'";
  if (/\/\//.test(name)) return "Branch name cannot contain consecutive slashes";
  if (name.endsWith(".lock")) return "Branch name cannot end with '.lock'";
  if (/@\{/.test(name)) return "Branch name cannot contain '@{'";
  return null;
}

export function NewWorktreeDialog({
  repository,
  onCreateWorktree,
  onClose,
}: NewWorktreeDialogProps) {
  const [branch, setBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState(repository.defaultBranch);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const branchError = useMemo(() => validateBranchName(branch), [branch]);
  const canCreate = branch.trim().length > 0 && !branchError && baseBranch.trim().length > 0;

  const handleCreate = async () => {
    if (!canCreate) return;

    setCreating(true);
    setError(null);
    try {
      await onCreateWorktree(
        repository.id,
        branch.trim(),
        baseBranch.trim(),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4">
          <div>
            <h2 className="text-lg font-semibold">Create Session</h2>
            <p className="text-sm text-muted-foreground">{repository.name}</p>
          </div>
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
            <label className="mb-1.5 block text-sm font-medium">Branch name</label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feat/my-feature"
              className="rounded-lg"
              autoFocus
              data-testid="worktree-branch-input"
            />
            {branchError && (
              <p className="mt-1 text-xs text-destructive">{branchError}</p>
            )}
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-sm text-muted-foreground hover:text-foreground">
              {advancedOpen ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Advanced options
            </CollapsibleTrigger>
            <Separator className="my-2" />
            <CollapsibleContent>
              <div className="pt-1">
                <label className="mb-1.5 block text-sm font-medium">Base branch</label>
                <Input
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder={repository.defaultBranch}
                  className="rounded-lg"
                />
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
              disabled={creating || !canCreate}
              onClick={handleCreate}
              data-testid="create-worktree-btn"
            >
              {creating ? "Creating..." : "Create Session"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
