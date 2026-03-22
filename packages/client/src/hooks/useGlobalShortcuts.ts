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
    // Normalize single characters to lowercase for consistent matching
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.push(key);
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
