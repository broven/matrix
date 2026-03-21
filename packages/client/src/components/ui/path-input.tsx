import { useState } from "react";
import type { MatrixClient } from "@matrix/sdk";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { FileExplorerDialog } from "@/components/repository/FileExplorerDialog";

interface PathInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when a path is selected via the file browser dialog */
  onBrowseSelect?: (path: string) => void;
  client: MatrixClient;
  placeholder?: string;
  "data-testid"?: string;
}

export function PathInput({
  value,
  onChange,
  onBrowseSelect,
  client,
  placeholder,
  "data-testid": testId,
}: PathInputProps) {
  const [showBrowser, setShowBrowser] = useState(false);

  const handleBrowseSelect = (path: string) => {
    onChange(path);
    onBrowseSelect?.(path);
    setShowBrowser(false);
  };

  return (
    <>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg font-mono text-sm"
          data-testid={testId}
        />
        <Button
          variant="outline"
          size="icon"
          className="size-9 shrink-0 rounded-lg"
          onClick={() => setShowBrowser(true)}
          data-testid={testId ? `${testId}-browse` : undefined}
        >
          <FolderOpen className="size-4" />
        </Button>
      </div>
      {showBrowser && (
        <FileExplorerDialog
          client={client}
          initialPath={value || undefined}
          onSelect={handleBrowseSelect}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </>
  );
}
