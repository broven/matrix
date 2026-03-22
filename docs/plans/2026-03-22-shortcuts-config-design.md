# Keyboard Shortcuts Configuration Panel — Design

## Overview

Add a configurable keyboard shortcuts panel to Settings > General. Users can view, rebind, and reset shortcuts with full conflict detection.

## Shortcut Actions

| ID | Label | Category | Default Keys |
|---|---|---|---|
| `send-message` | Send Message | chat | `Enter` |
| `new-line` | New Line | chat | `Shift+Enter` |
| `create-session` | Create New Session | session | `⌘+N` |
| `close-session` | Close Session | session | `⌘+W` |
| `open-settings` | Open Settings | navigation | `⌘+,` |
| `toggle-sidebar` | Toggle Sidebar | navigation | `⌘+B` |
| `focus-prompt` | Focus Prompt Input | navigation | `⌘+L` |

## Data Model & Store

### Types

```typescript
interface Shortcut {
  id: string;           // e.g. "send-message"
  label: string;        // e.g. "Send Message"
  category: "chat" | "session" | "navigation";
  keys: string[];       // e.g. ["Meta", "Enter"] or ["Shift", "Enter"]
  defaultKeys: string[];
}

interface ShortcutStoreState {
  shortcuts: Shortcut[];
  updateShortcut: (id: string, keys: string[]) => void;
  resetShortcut: (id: string) => void;
  resetAll: () => void;
  getConflicts: (id: string, keys: string[]) => Shortcut[];
}
```

### Persistence

- **Storage**: Tauri store (`shortcuts.json`)
- Only user-modified bindings are persisted
- Defaults are hardcoded and merged at load time — new shortcuts added in future versions appear automatically

### Hook

`useShortcutStore()` — React Context + Tauri store pattern, consistent with existing `useServerStore`.

## Global Shortcut Listener

`useGlobalShortcuts` hook, mounted once at `App.tsx` level:

- Single `keydown` listener on `window`
- Reads current bindings from `ShortcutStoreContext`
- Matches pressed key combo against registered shortcuts
- Dispatches via a callback map:

```typescript
const actionHandlers: Record<string, () => void> = {
  "send-message":    () => { /* handled locally in PromptInput */ },
  "new-line":        () => { /* handled locally in PromptInput */ },
  "create-session":  () => createSession(),
  "close-session":   () => closeSession(),
  "open-settings":   () => navigate("/settings"),
  "toggle-sidebar":  () => setSidebarOpen(prev => !prev),
  "focus-prompt":    () => editorRef.current?.focus(),
};
```

### Special handling: `send-message` and `new-line`

These two actions are handled inside `PromptInput`'s tiptap editor, not by the global listener. `usePromptEditor` reads bindings from the shortcut store and configures tiptap's key handlers accordingly. The global listener skips these two actions.

This avoids fighting with tiptap's own keyboard handling while still allowing rebinding from Settings.

## Settings UI — Shortcuts Panel

### Location

New section in `SettingsGeneralTab.tsx`, below the existing "About" section.

### Layout

- Section header **"Keyboard Shortcuts"** with a **"Reset All"** button (right-aligned)
- Three groups with subheadings: **Chat**, **Session**, **Navigation**
- Each row: `Action label | Key badge(s) | Edit button (pencil icon)`

### Edit Flow

1. User clicks pencil icon (or double-clicks the row)
2. Row enters recording mode — key badge area shows pulsing **"Press desired shortcut..."**
3. User presses key combo — displayed immediately as `<kbd>` badges
4. **Conflict detected**: yellow inline banner below the row — _"Already assigned to **{action}**"_. Two buttons: **Override** (reassigns, clears the other) / **Cancel**
5. `Enter` confirms, `Esc` cancels recording
6. Rows with non-default bindings show a small **"reset"** link

### Components

| Component | Responsibility |
|---|---|
| `ShortcutsSection` | Wraps groups, handles reset-all |
| `ShortcutRow` | Single row with display/recording states |
| `KeyRecorder` | Captures keydown in recording mode, normalizes modifier order (Ctrl → Shift → Alt → Meta → key) |
| `ShortcutBadge` | Styled `<kbd>` elements with macOS symbols (⌘ ⇧ ⌥ ⌃) |

### data-testid Attributes

- `shortcuts-section`
- `shortcut-row-{id}` (e.g. `shortcut-row-send-message`)
- `shortcut-edit-btn-{id}`
- `shortcut-reset-btn-{id}`
- `shortcuts-reset-all-btn`
- `shortcut-conflict-banner`
