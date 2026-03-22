import { useEffect } from "react";
import { useShortcutStore } from "./useShortcutStore";
import { eventToKeys, keysMatch } from "@/lib/keyboard";

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
      // Ignore key repeats to prevent rapid-fire shortcut execution
      if (e.repeat) return;

      // Skip if focused in an input, textarea, select, or contenteditable element
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        target.closest("[contenteditable='true']")
      ) {
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
