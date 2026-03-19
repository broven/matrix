import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, FolderOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileExplorerDialog } from "./FileExplorerDialog";
import type { MatrixClient } from "@matrix/sdk";

interface OpenProjectDialogProps {
  client: MatrixClient;
  onAdd: (path: string, name?: string) => Promise<void>;
  onClose: () => void;
}

export function OpenProjectDialog({ client, onAdd, onClose }: OpenProjectDialogProps) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(false);

  useEffect(() => {
    if (path) {
      const basename = path.replace(/\/+$/, "").split("/").pop() || "";
      setName(basename);
    }
  }, [path]);

  const handleOpen = async () => {
    if (!path.trim()) return;

    setAdding(true);
    setError(null);
    try {
      await onAdd(path.trim(), name.trim() || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open project");
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
        <div
          className="mx-4 w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-4">
            <h2 className="text-lg font-semibold">Open Project</h2>
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
                Project path
              </label>
              <div className="flex gap-2">
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/path/to/your/project"
                  className="rounded-lg"
                  autoFocus
                  data-testid="path-input"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 rounded-lg"
                  onClick={() => setShowFileBrowser(true)}
                >
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Display name <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Auto-detected from path"
                className="rounded-lg"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                className={cn("rounded-lg")}
                disabled={adding || !path.trim()}
                onClick={handleOpen}
                data-testid="confirm-btn"
              >
                {adding ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Opening...
                  </>
                ) : (
                  "Open Project"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {showFileBrowser && (
        <FileExplorerDialog
          client={client}
          onSelect={(selectedPath) => {
            setPath(selectedPath);
            setShowFileBrowser(false);
          }}
          onClose={() => setShowFileBrowser(false)}
        />
      )}
    </>
  );
}
