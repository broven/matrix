import { useState } from "react";
import type { RepositoryInfo } from "@matrix/protocol";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SettingsRepositoryTabProps {
  repository: RepositoryInfo;
  onDeleteRepository: (repositoryId: string, deleteSource: boolean) => Promise<void> | void;
}

export function SettingsRepositoryTab({ repository, onDeleteRepository }: SettingsRepositoryTabProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteSource, setDeleteSource] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteRepository(repository.id, deleteSource);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <h3 className="text-2xl font-semibold">{repository.name}</h3>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <div className="space-y-1">
            <div className="font-medium text-foreground">Path</div>
            <div className="break-all text-muted-foreground">{repository.path}</div>
          </div>
          <div className="space-y-1">
            <div className="font-medium text-foreground">Remote URL</div>
            <div className="break-all text-muted-foreground">{repository.remoteUrl ?? "-"}</div>
          </div>
          <div className="space-y-1">
            <div className="font-medium text-foreground">Default branch</div>
            <div className="text-muted-foreground">{repository.defaultBranch}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-auto border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">Delete Repository</div>
            <div className="text-sm text-muted-foreground">
              Permanently remove this repository and its tracked worktrees from Matrix.
            </div>
          </div>
          <Button variant="destructive" onClick={() => { setDeleteSource(false); setConfirmingDelete(true); }}>
            Delete Repository
          </Button>
        </CardContent>
      </Card>

      {confirmingDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Delete repository?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete {repository.name}?
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deleteSource}
                onChange={(e) => setDeleteSource(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <span className="text-muted-foreground">Also delete source files on disk</span>
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
