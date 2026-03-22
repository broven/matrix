import { useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Shortcut } from "@/hooks/useShortcutStore";
import { ShortcutBadge } from "./ShortcutBadge";
import { KeyRecorder } from "./KeyRecorder";

interface ShortcutRowProps {
  shortcut: Shortcut;
  onUpdate: (keys: string[]) => void;
  onReset: () => void;
  onCheckConflicts: (keys: string[]) => Shortcut[];
}

export function ShortcutRow({ shortcut, onUpdate, onReset, onCheckConflicts }: ShortcutRowProps) {
  const [editing, setEditing] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string[] | null>(null);
  const [conflicts, setConflicts] = useState<Shortcut[]>([]);

  const isModified = JSON.stringify(shortcut.keys) !== JSON.stringify(shortcut.defaultKeys);

  const handleRecord = (keys: string[]) => {
    const found = onCheckConflicts(keys);
    if (found.length > 0) {
      setPendingKeys(keys);
      setConflicts(found);
    } else {
      onUpdate(keys);
      setEditing(false);
      setPendingKeys(null);
      setConflicts([]);
    }
  };

  const handleOverride = () => {
    if (pendingKeys) {
      onUpdate(pendingKeys);
      setEditing(false);
      setPendingKeys(null);
      setConflicts([]);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setPendingKeys(null);
    setConflicts([]);
  };

  return (
    <div data-testid={`shortcut-row-${shortcut.id}`}>
      <div className="flex items-center justify-between py-1.5">
        <span className="text-sm">{shortcut.label}</span>
        <div className="flex items-center gap-2">
          {editing ? (
            <KeyRecorder onRecord={handleRecord} onCancel={handleCancel} />
          ) : (
            <ShortcutBadge keys={shortcut.keys} />
          )}
          {!editing && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setEditing(true)}
              data-testid={`shortcut-edit-btn-${shortcut.id}`}
            >
              <Pencil className="size-3" />
            </Button>
          )}
          {isModified && !editing && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onReset}
              data-testid={`shortcut-reset-btn-${shortcut.id}`}
            >
              <RotateCcw className="size-3" />
            </Button>
          )}
        </div>
      </div>
      {conflicts.length > 0 && (
        <div
          className="mb-2 flex items-center gap-2 rounded border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-xs"
          data-testid="shortcut-conflict-banner"
        >
          <span className="flex-1">
            Already assigned to <strong>{conflicts.map((c) => c.label).join(", ")}</strong>
          </span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleOverride} data-testid="shortcut-override-btn">
            Override
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleCancel} data-testid="shortcut-cancel-btn">
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
