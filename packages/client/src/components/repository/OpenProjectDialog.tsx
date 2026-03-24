import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PathInput } from "@/components/ui/path-input";
import { ServerSelect } from "@/components/ui/server-select";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MatrixClient } from "@matrix/sdk";
import { useAddRepoServerSelect } from "@/hooks/useAddRepoServerSelect";

interface OpenProjectDialogProps {
  client: MatrixClient;
  onAdd: (path: string, name?: string, client?: MatrixClient) => Promise<void>;
  onClose: () => void;
}

export function OpenProjectDialog({ client: fallbackClient, onAdd, onClose }: OpenProjectDialogProps) {
  const { servers, selectedServerId, setSelectedServerId, selectedClient, showSelector } = useAddRepoServerSelect();
  const activeClient = selectedClient ?? fallbackClient;
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inferName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || "";

  const handleBrowseSelect = (selectedPath: string) => {
    if (!nameManuallyEdited) {
      setName(inferName(selectedPath));
    }
  };

  const handleOpen = async () => {
    if (!path.trim()) return;

    setAdding(true);
    setError(null);
    try {
      await onAdd(path.trim(), name.trim() || undefined, activeClient);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open project");
    } finally {
      setAdding(false);
    }
  };

  return (
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
          {showSelector && (
            <ServerSelect
              servers={servers}
              value={selectedServerId}
              onChange={setSelectedServerId}
            />
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Project path
            </label>
            <PathInput
              value={path}
              onChange={setPath}
              onBrowseSelect={handleBrowseSelect}
              client={activeClient}
              placeholder="/path/to/your/project"
              data-testid="path-input"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Display name <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameManuallyEdited(true); }}
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
  );
}
