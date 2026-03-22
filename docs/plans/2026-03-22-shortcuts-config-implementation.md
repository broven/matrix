# Keyboard Shortcuts Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a configurable keyboard shortcuts panel to Settings > General with full rebinding and conflict detection.

**Architecture:** React Context store (`useShortcutStore`) persisted via Tauri store, a global keyboard listener (`useGlobalShortcuts`), and a Settings UI section with VS Code-style shortcut editing. Chat shortcuts (send/newline) are handled locally in tiptap via the store; all others via the global listener.

**Tech Stack:** React 19, TypeScript, Tauri store, Tiptap, Tailwind CSS, Radix UI, Lucide icons

---

### Task 1: Shortcut Store — Types & Defaults

**Files:**
- Create: `packages/client/src/hooks/useShortcutStore.tsx`

**Step 1: Create the shortcut store with types, defaults, and Tauri persistence**

```typescript
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { isTauri } from "@/lib/platform";

export type ShortcutCategory = "chat" | "session" | "navigation";

export interface Shortcut {
  id: string;
  label: string;
  category: ShortcutCategory;
  keys: string[];       // e.g. ["Meta", "Enter"]
  defaultKeys: string[];
}

export interface ShortcutStoreState {
  shortcuts: Shortcut[];
  updateShortcut: (id: string, keys: string[]) => void;
  resetShortcut: (id: string) => void;
  resetAll: () => void;
  getConflicts: (id: string, keys: string[]) => Shortcut[];
  getShortcut: (id: string) => Shortcut | undefined;
}

const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: "send-message", label: "Send Message", category: "chat", keys: ["Enter"], defaultKeys: ["Enter"] },
  { id: "new-line", label: "New Line", category: "chat", keys: ["Shift", "Enter"], defaultKeys: ["Shift", "Enter"] },
  { id: "create-session", label: "Create New Session", category: "session", keys: ["Meta", "n"], defaultKeys: ["Meta", "n"] },
  { id: "close-session", label: "Close Session", category: "session", keys: ["Meta", "w"], defaultKeys: ["Meta", "w"] },
  { id: "open-settings", label: "Open Settings", category: "navigation", keys: ["Meta", ","], defaultKeys: ["Meta", ","] },
  { id: "toggle-sidebar", label: "Toggle Sidebar", category: "navigation", keys: ["Meta", "b"], defaultKeys: ["Meta", "b"] },
  { id: "focus-prompt", label: "Focus Prompt Input", category: "navigation", keys: ["Meta", "l"], defaultKeys: ["Meta", "l"] },
];

const ShortcutStoreContext = createContext<ShortcutStoreState>({
  shortcuts: DEFAULT_SHORTCUTS,
  updateShortcut: () => {},
  resetShortcut: () => {},
  resetAll: () => {},
  getConflicts: () => [],
  getShortcut: () => undefined,
});

export function useShortcutStore() {
  return useContext(ShortcutStoreContext);
}

const STORAGE_KEY = "matrix:shortcuts";

// Tauri store instance (lazy-loaded)
let tauriStore: any = null;

async function getTauriStore() {
  if (tauriStore) return tauriStore;
  if (!isTauri()) return null;
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    tauriStore = new LazyStore("shortcuts.json");
    return tauriStore;
  } catch {
    return null;
  }
}

// Only persist user overrides (keys that differ from defaults)
type PersistedOverrides = Record<string, string[]>; // id → keys

async function loadOverrides(): Promise<PersistedOverrides> {
  const store = await getTauriStore();
  if (store) {
    const data: PersistedOverrides | undefined = await store.get(STORAGE_KEY);
    return data ?? {};
  }
  return {};
}

async function persistOverrides(overrides: PersistedOverrides): Promise<void> {
  const store = await getTauriStore();
  if (store) {
    await store.set(STORAGE_KEY, overrides);
  }
}

function mergeWithDefaults(overrides: PersistedOverrides): Shortcut[] {
  return DEFAULT_SHORTCUTS.map((def) => ({
    ...def,
    keys: overrides[def.id] ?? [...def.defaultKeys],
  }));
}

function computeOverrides(shortcuts: Shortcut[]): PersistedOverrides {
  const overrides: PersistedOverrides = {};
  for (const s of shortcuts) {
    if (JSON.stringify(s.keys) !== JSON.stringify(s.defaultKeys)) {
      overrides[s.id] = s.keys;
    }
  }
  return overrides;
}

export function ShortcutStoreProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    loadOverrides().then((overrides) => {
      setShortcuts(mergeWithDefaults(overrides));
    });
  }, []);

  const save = useCallback((updated: Shortcut[]) => {
    setShortcuts(updated);
    persistOverrides(computeOverrides(updated));
  }, []);

  const updateShortcut = useCallback((id: string, keys: string[]) => {
    setShortcuts((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, keys } : s));
      persistOverrides(computeOverrides(updated));
      return updated;
    });
  }, []);

  const resetShortcut = useCallback((id: string) => {
    setShortcuts((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, keys: [...s.defaultKeys] } : s,
      );
      persistOverrides(computeOverrides(updated));
      return updated;
    });
  }, []);

  const resetAll = useCallback(() => {
    const reset = DEFAULT_SHORTCUTS.map((s) => ({ ...s, keys: [...s.defaultKeys] }));
    setShortcuts(reset);
    persistOverrides({});
  }, []);

  const getConflicts = useCallback((id: string, keys: string[]) => {
    const keyStr = JSON.stringify(keys);
    return shortcuts.filter((s) => s.id !== id && JSON.stringify(s.keys) === keyStr);
  }, [shortcuts]);

  const getShortcut = useCallback((id: string) => {
    return shortcuts.find((s) => s.id === id);
  }, [shortcuts]);

  return (
    <ShortcutStoreContext.Provider value={{ shortcuts, updateShortcut, resetShortcut, resetAll, getConflicts, getShortcut }}>
      {children}
    </ShortcutStoreContext.Provider>
  );
}
```

**Step 2: Wire provider into App.tsx**

In `packages/client/src/App.tsx`, wrap `<AppContent />` with `<ShortcutStoreProvider>`:

```typescript
// Add import at top:
import { ShortcutStoreProvider } from "./hooks/useShortcutStore";

// In App(), wrap inside the existing providers:
export function App() {
  return (
    <MatrixClientsProvider>
      <MatrixClientProvider>
        <ServerStoreProvider>
          <ShortcutStoreProvider>
            <UpdateProvider>
              <AppContent />
            </UpdateProvider>
          </ShortcutStoreProvider>
        </ServerStoreProvider>
      </MatrixClientProvider>
    </MatrixClientsProvider>
  );
}
```

**Step 3: Commit**

```bash
git add packages/client/src/hooks/useShortcutStore.tsx packages/client/src/App.tsx
git commit -m "feat(shortcuts): add shortcut store with Tauri persistence"
```

---

### Task 2: Global Shortcut Listener

**Files:**
- Create: `packages/client/src/hooks/useGlobalShortcuts.ts`
- Modify: `packages/client/src/components/layout/AppLayout.tsx`

**Step 1: Create the global shortcut listener hook**

```typescript
import { useEffect } from "react";
import { useShortcutStore } from "./useShortcutStore";

// Normalize a KeyboardEvent into sorted key array matching our store format
export function eventToKeys(e: KeyboardEvent): string[] {
  const keys: string[] = [];
  if (e.ctrlKey) keys.push("Control");
  if (e.shiftKey) keys.push("Shift");
  if (e.altKey) keys.push("Alt");
  if (e.metaKey) keys.push("Meta");

  // Don't add modifier-only keys as the main key
  const modifierKeys = new Set(["Control", "Shift", "Alt", "Meta"]);
  if (!modifierKeys.has(e.key)) {
    keys.push(e.key);
  }

  return keys;
}

export function keysMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((key, i) => key === sortedB[i]);
}

// IDs handled locally by tiptap, not by the global listener
const LOCAL_SHORTCUT_IDS = new Set(["send-message", "new-line"]);

interface GlobalShortcutHandlers {
  "create-session": () => void;
  "close-session": () => void;
  "open-settings": () => void;
  "toggle-sidebar": () => void;
  "focus-prompt": () => void;
}

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers) {
  const { shortcuts } = useShortcutStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focused in an input/textarea (except our tiptap editor)
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
        return;
      }

      const pressedKeys = eventToKeys(e);
      if (pressedKeys.length === 0) return;

      for (const shortcut of shortcuts) {
        if (LOCAL_SHORTCUT_IDS.has(shortcut.id)) continue;
        if (!keysMatch(pressedKeys, shortcut.keys)) continue;

        const handler = handlers[shortcut.id as keyof GlobalShortcutHandlers];
        if (handler) {
          e.preventDefault();
          e.stopPropagation();
          handler();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, handlers]);
}
```

**Step 2: Wire into AppLayout.tsx**

In `packages/client/src/components/layout/AppLayout.tsx`, add the global shortcut hook inside the `AppLayout` component. Add after the existing state declarations (around line 69):

```typescript
// Add import:
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

// Inside AppLayout(), after existing state declarations, add:
const shortcutHandlers = useMemo(() => ({
  "create-session": () => {
    // Create session on first available repo's cwd
    const firstRepo = repositories[0];
    if (firstRepo && client) {
      void handleCreateSession("", firstRepo.path);
    }
  },
  "close-session": () => {
    if (selectedSessionId) {
      void handleDeleteSession(selectedSessionId);
    }
  },
  "open-settings": () => setShowSettings(true),
  "toggle-sidebar": () => setMobileSidebarOpen((prev) => !prev),
  "focus-prompt": () => {
    // Focus the tiptap editor
    const el = document.querySelector('[data-testid="chat-input"]') as HTMLElement;
    el?.focus();
  },
}), [repositories, client, selectedSessionId]);

useGlobalShortcuts(shortcutHandlers);
```

Note: `useMemo` is already imported in AppLayout.tsx.

**Step 3: Commit**

```bash
git add packages/client/src/hooks/useGlobalShortcuts.ts packages/client/src/components/layout/AppLayout.tsx
git commit -m "feat(shortcuts): add global keyboard shortcut listener"
```

---

### Task 3: Integrate Shortcut Store with Tiptap Editor

**Files:**
- Modify: `packages/client/src/components/prompt/usePromptEditor.ts:208-218`

**Step 1: Update the tiptap handleKeyDown to read from the shortcut store**

The current code at lines 208-218 of `usePromptEditor.ts` hardcodes Enter/Shift+Enter. Replace that with dynamic shortcut matching.

First, add a new option to `UsePromptEditorOptions`:

```typescript
// Add import at top:
import { keysMatch, eventToKeys } from "@/hooks/useGlobalShortcuts";

// Add to UsePromptEditorOptions interface (line 16-23):
interface UsePromptEditorOptions {
  placeholder: string;
  editable: boolean;
  fetchFilesRef: React.RefObject<((query: string) => Promise<string[]>) | null>;
  commands: AvailableCommand[];
  onEnter: () => void;
  onUpdate?: () => void;
  sendKeys?: string[];    // e.g. ["Enter"] — from shortcut store
  newLineKeys?: string[]; // e.g. ["Shift", "Enter"] — from shortcut store
}
```

Then update the `handleKeyDown` (lines 208-218) to use the passed keys:

```typescript
// Add refs for the keys near other refs (after line 43):
const sendKeysRef = useRef(sendKeys ?? ["Enter"]);
sendKeysRef.current = sendKeys ?? ["Enter"];
const newLineKeysRef = useRef(newLineKeys ?? ["Shift", "Enter"]);
newLineKeysRef.current = newLineKeys ?? ["Shift", "Enter"];
```

Replace lines 208-218:

```typescript
handleKeyDown(_view, event) {
  // Don't intercept when a suggestion popup is open
  if (popupRef.current.type !== null) return false;

  const pressed = eventToKeys(event as unknown as KeyboardEvent);
  if (pressed.length === 0) return false;

  if (keysMatch(pressed, sendKeysRef.current)) {
    event.preventDefault();
    onEnterRef.current();
    return true;
  }

  // If newline keys match, allow default tiptap behavior (insert newline)
  if (keysMatch(pressed, newLineKeysRef.current)) {
    return false;
  }

  return false;
},
```

**Step 2: Update PromptInput.tsx to pass shortcut keys from the store**

In the file that calls `usePromptEditor` (likely `packages/client/src/components/PromptInput.tsx` or `packages/client/src/components/prompt/PromptInput.tsx`), add:

```typescript
// Add import:
import { useShortcutStore } from "@/hooks/useShortcutStore";

// Inside the component, before the usePromptEditor call:
const { getShortcut } = useShortcutStore();
const sendShortcut = getShortcut("send-message");
const newLineShortcut = getShortcut("new-line");

// Pass to usePromptEditor:
const { editor, popup, fileSelectedIndex, slashSelectedIndex } = usePromptEditor({
  placeholder,
  editable,
  fetchFilesRef,
  commands,
  onEnter: handleSend,
  onUpdate: handleEditorUpdate,
  sendKeys: sendShortcut?.keys,
  newLineKeys: newLineShortcut?.keys,
});
```

**Step 3: Commit**

```bash
git add packages/client/src/components/prompt/usePromptEditor.ts packages/client/src/components/prompt/PromptInput.tsx
git commit -m "feat(shortcuts): integrate shortcut store with tiptap editor"
```

---

### Task 4: Settings UI — ShortcutBadge Component

**Files:**
- Create: `packages/client/src/pages/settings/ShortcutBadge.tsx`

**Step 1: Create the ShortcutBadge component**

```typescript
const MAC_SYMBOLS: Record<string, string> = {
  Meta: "⌘",
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Enter: "↵",
  Backspace: "⌫",
  Delete: "⌦",
  Escape: "⎋",
  Tab: "⇥",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  " ": "Space",
};

function formatKey(key: string): string {
  return MAC_SYMBOLS[key] ?? key.length === 1 ? key.toUpperCase() : key;
}

interface ShortcutBadgeProps {
  keys: string[];
}

export function ShortcutBadge({ keys }: ShortcutBadgeProps) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
        >
          {formatKey(key)}
        </kbd>
      ))}
    </span>
  );
}
```

**Step 2: Commit**

```bash
git add packages/client/src/pages/settings/ShortcutBadge.tsx
git commit -m "feat(shortcuts): add ShortcutBadge component"
```

---

### Task 5: Settings UI — KeyRecorder Component

**Files:**
- Create: `packages/client/src/pages/settings/KeyRecorder.tsx`

**Step 1: Create the KeyRecorder component**

This captures keyboard input when in recording mode:

```typescript
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
```

**Step 2: Commit**

```bash
git add packages/client/src/pages/settings/KeyRecorder.tsx
git commit -m "feat(shortcuts): add KeyRecorder component"
```

---

### Task 6: Settings UI — ShortcutRow Component

**Files:**
- Create: `packages/client/src/pages/settings/ShortcutRow.tsx`

**Step 1: Create ShortcutRow with display/edit/conflict states**

```typescript
import { useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Shortcut } from "@/hooks/useShortcutStore";
import { ShortcutBadge } from "./ShortcutBadge";
import { KeyRecorder } from "./KeyRecorder";

interface ShortcutRowProps {
  shortcut: Shortcut;
  conflicts: Shortcut[];
  onUpdate: (keys: string[]) => void;
  onReset: () => void;
  onCheckConflicts: (keys: string[]) => Shortcut[];
}

export function ShortcutRow({ shortcut, conflicts: _unused, onUpdate, onReset, onCheckConflicts }: ShortcutRowProps) {
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
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleOverride}>
            Override
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add packages/client/src/pages/settings/ShortcutRow.tsx
git commit -m "feat(shortcuts): add ShortcutRow component with conflict detection"
```

---

### Task 7: Settings UI — ShortcutsSection & Integration

**Files:**
- Create: `packages/client/src/pages/settings/ShortcutsSection.tsx`
- Modify: `packages/client/src/pages/settings/SettingsGeneralTab.tsx`

**Step 1: Create ShortcutsSection component**

```typescript
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
  const { shortcuts, updateShortcut, resetShortcut, resetAll, getConflicts } = useShortcutStore();

  const handleUpdate = (id: string, keys: string[]) => {
    // Clear conflicts: if another shortcut has the same keys, reset it
    const conflicts = getConflicts(id, keys);
    for (const c of conflicts) {
      resetShortcut(c.id);
    }
    updateShortcut(id, keys);
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
                    conflicts={[]}
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
```

**Step 2: Add ShortcutsSection to SettingsGeneralTab**

In `packages/client/src/pages/settings/SettingsGeneralTab.tsx`, add the shortcuts section below the About card.

Add import at top:
```typescript
import { ShortcutsSection } from "./ShortcutsSection";
```

After the closing `)}` of the `{isTauri() && (` block (after the About Card, before the closing `</div>`), add:

```typescript
<ShortcutsSection />
```

So the full return becomes:
```typescript
return (
  <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
    {isTauri() && (
      <Card>
        {/* ... existing About card ... */}
      </Card>
    )}
    <ShortcutsSection />
  </div>
);
```

**Step 3: Commit**

```bash
git add packages/client/src/pages/settings/ShortcutsSection.tsx packages/client/src/pages/settings/SettingsGeneralTab.tsx
git commit -m "feat(shortcuts): add shortcuts section to Settings General tab"
```

---

### Task 8: Type Check & Manual Verification

**Step 1: Run the TypeScript compiler to check for type errors**

```bash
cd packages/client && npx tsc --noEmit
```

Expected: no errors. Fix any issues found.

**Step 2: Run existing tests to make sure nothing is broken**

```bash
cd packages/client && npx vitest run
```

Expected: all existing tests pass.

**Step 3: Commit any fixes**

```bash
git add -u
git commit -m "fix(shortcuts): resolve type and test issues"
```

---

### Task 9: Final Cleanup & Summary Commit

**Step 1: Review all new files for consistency**

Check:
- All interactive elements have `data-testid` attributes per CLAUDE.md
- No unused imports
- Consistent naming (kebab-case for test IDs)

**Step 2: Run linting if configured**

```bash
cd packages/client && npm run lint 2>/dev/null || true
```

Fix any linting issues.

**Step 3: Final commit if any fixes were needed**

```bash
git add -u
git commit -m "chore(shortcuts): cleanup and lint fixes"
```
