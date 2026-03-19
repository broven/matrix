import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface AddRepositoryDialogProps {
  onAdd: (path: string, name?: string) => Promise<void>;
  onClose: () => void;
}

export function AddRepositoryDialog({ onAdd, onClose }: AddRepositoryDialogProps) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!path.trim()) return;

    setAdding(true);
    setError(null);
    try {
      await onAdd(path.trim(), name.trim() || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add repository");
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
          <h2 className="text-lg font-semibold">Add Repository</h2>
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
              Repository path
            </label>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/your/repo"
              className="rounded-lg"
              autoFocus
            />
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
              className="rounded-lg"
              disabled={adding || !path.trim()}
              onClick={handleAdd}
            >
              {adding ? "Adding..." : "Add Repository"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
