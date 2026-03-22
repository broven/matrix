import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { isTauri } from "@/lib/platform";
import { keysMatch } from "@/lib/keyboard";

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
    await store.save();
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
    if (!keysMatch(s.keys, s.defaultKeys)) {
      overrides[s.id] = s.keys;
    }
  }
  return overrides;
}

export function ShortcutStoreProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(DEFAULT_SHORTCUTS);

  useEffect(() => {
    void loadOverrides()
      .then((overrides) => setShortcuts(mergeWithDefaults(overrides)))
      .catch((err) => {
        console.error("Failed to load shortcut overrides:", err);
        setShortcuts(DEFAULT_SHORTCUTS);
      });
  }, []);

  const updateShortcut = useCallback((id: string, keys: string[]) => {
    setShortcuts((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, keys } : s));
      persistOverrides(computeOverrides(updated)).catch((err) =>
        console.error("Failed to persist shortcut overrides:", err),
      );
      return updated;
    });
  }, []);

  const resetShortcut = useCallback((id: string) => {
    setShortcuts((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, keys: [...s.defaultKeys] } : s,
      );
      persistOverrides(computeOverrides(updated)).catch((err) =>
        console.error("Failed to persist shortcut overrides:", err),
      );
      return updated;
    });
  }, []);

  const resetAll = useCallback(() => {
    const reset = DEFAULT_SHORTCUTS.map((s) => ({ ...s, keys: [...s.defaultKeys] }));
    setShortcuts(reset);
    persistOverrides({}).catch((err) =>
      console.error("Failed to persist shortcut overrides:", err),
    );
  }, []);

  const getConflicts = useCallback((id: string, keys: string[]) => {
    if (keys.length === 0) return [];
    return shortcuts.filter((s) => s.id !== id && s.keys.length > 0 && keysMatch(s.keys, keys));
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
