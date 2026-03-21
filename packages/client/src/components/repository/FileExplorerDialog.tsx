import { useEffect, useRef, useState } from "react";
import type { MatrixClient } from "@matrix/sdk";
import type { FsEntry } from "@matrix/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, FolderGit2, Folder, ArrowUp, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const msg = err.message.toLowerCase();
  return msg === "load failed" || msg === "failed to fetch" || msg === "networkerror when attempting to fetch resource.";
}

interface FileExplorerDialogProps {
  client: MatrixClient;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FileExplorerDialog({
  client,
  initialPath,
  onSelect,
  onClose,
}: FileExplorerDialogProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? "~");
  const [pathInput, setPathInput] = useState(initialPath ?? "~");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FsEntry | null>(null);
  const loadIdRef = useRef(0);

  const loadDirectory = async (path: string) => {
    const id = ++loadIdRef.current;
    setLoading(true);
    setError(null);
    setSelectedEntry(null);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (id !== loadIdRef.current) return; // superseded by newer load
      try {
        const res = await client.listDirectory(path);
        if (id !== loadIdRef.current) return;
        setEntries(res.entries);
        setCurrentPath(path);
        setPathInput(path);
        setLoading(false);
        return;
      } catch (err) {
        if (id !== loadIdRef.current) return;
        // Only retry on network errors, not server-side errors
        if (isNetworkError(err) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        const message = isNetworkError(err)
          ? "Could not reach server"
          : err instanceof Error ? err.message : "Failed to list directory";
        setError(message);
        setLoading(false);
        return;
      }
    }
  };

  useEffect(() => {
    loadDirectory(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    loadDirectory(parent);
  };

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && pathInput.trim()) {
      loadDirectory(pathInput.trim());
    }
  };

  const handleEntryClick = (entry: FsEntry) => {
    if (entry.isGitRepo) {
      setSelectedEntry(entry);
    } else if (entry.isDir) {
      loadDirectory(entry.path);
    }
  };

  const handleSelect = () => {
    onSelect(selectedEntry ? selectedEntry.path : currentPath);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-lg rounded-2xl border border-border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4">
          <h2 className="text-lg font-semibold">Browse Files</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 pb-3">
          <Button
            variant="outline"
            size="icon"
            className="size-9 shrink-0 rounded-lg"
            onClick={navigateUp}
            disabled={currentPath === "/"}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={handlePathKeyDown}
            placeholder="/"
            className="rounded-lg font-mono text-sm"
          />
        </div>

        <ScrollArea className="h-72 rounded-lg border border-border">
          {loading ? (
            <div className="flex h-full items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-12">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => loadDirectory(currentPath)}
                data-testid="retry-btn"
              >
                <RefreshCw className="size-3" />
                Retry
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-full items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">Empty directory</p>
            </div>
          ) : (
            <div className="p-1">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => handleEntryClick(entry)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    selectedEntry?.path === entry.path && "bg-accent",
                  )}
                >
                  {entry.isGitRepo ? (
                    <FolderGit2 className="size-4 shrink-0 text-primary" />
                  ) : (
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{entry.name}</span>
                  {entry.isGitRepo && (
                    <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                      git repo
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="rounded-lg"
            disabled={loading}
            onClick={handleSelect}
          >
            Select
          </Button>
        </div>
      </div>
    </div>
  );
}
