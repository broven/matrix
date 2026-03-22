import { useEffect, useRef, useState } from "react";
import { eventToKeys } from "@/hooks/useGlobalShortcuts";
import { ShortcutBadge } from "./ShortcutBadge";

interface KeyRecorderProps {
  onRecord: (keys: string[]) => void;
  onCancel: () => void;
}

export function KeyRecorder({ onRecord, onCancel }: KeyRecorderProps) {
  const [recordedKeys, setRecordedKeys] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onCancel();
        return;
      }

      const keys = eventToKeys(e);
      // Ignore modifier-only presses
      const modifierKeys = new Set(["Control", "Shift", "Alt", "Meta"]);
      const hasNonModifier = keys.some((k) => !modifierKeys.has(k));
      if (!hasNonModifier) return;

      setRecordedKeys(keys);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Confirm on keyup if we have recorded keys
      if (recordedKeys) {
        onRecord(recordedKeys);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [recordedKeys, onRecord, onCancel]);

  return (
    <div
      ref={ref}
      tabIndex={0}
      className="flex items-center gap-2 outline-none"
      data-testid="key-recorder"
    >
      {recordedKeys ? (
        <ShortcutBadge keys={recordedKeys} />
      ) : (
        <span className="animate-pulse text-xs text-muted-foreground">
          Press desired shortcut...
        </span>
      )}
    </div>
  );
}
