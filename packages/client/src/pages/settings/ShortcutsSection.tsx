import { Keyboard, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useShortcutStore, type ShortcutCategory } from "@/hooks/useShortcutStore";
import { ShortcutRow } from "./ShortcutRow";

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  chat: "Chat",
  session: "Session",
  navigation: "Navigation",
};

const CATEGORY_ORDER: ShortcutCategory[] = ["chat", "session", "navigation"];

export function ShortcutsSection() {
  const { shortcuts, bulkUpdate, resetShortcut, resetAll, getConflicts } = useShortcutStore();

  const handleUpdate = (id: string, keys: string[]) => {
    // Atomically unbind conflicts and assign new keys in a single update
    const conflicts = getConflicts(id, keys);
    const updates = [
      ...conflicts.map((c) => ({ id: c.id, keys: [] as string[] })),
      { id, keys },
    ];
    bulkUpdate(updates);
  };

  return (
    <Card data-testid="shortcuts-section">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Keyboard className="size-4" />
            Keyboard Shortcuts
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={resetAll}
            data-testid="shortcuts-reset-all-btn"
          >
            <RotateCcw className="mr-1 size-3" />
            Reset All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {CATEGORY_ORDER.map((category) => {
          const categoryShortcuts = shortcuts.filter((s) => s.category === category);
          if (categoryShortcuts.length === 0) return null;
          return (
            <div key={category}>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {CATEGORY_LABELS[category]}
              </h4>
              <div className="divide-y divide-border">
                {categoryShortcuts.map((shortcut) => (
                  <ShortcutRow
                    key={shortcut.id}
                    shortcut={shortcut}
                    onUpdate={(keys) => handleUpdate(shortcut.id, keys)}
                    onReset={() => resetShortcut(shortcut.id)}
                    onCheckConflicts={(keys) => getConflicts(shortcut.id, keys)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
