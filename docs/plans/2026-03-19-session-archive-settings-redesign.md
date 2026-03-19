# Session Archive Button + Settings Page Redesign

## Overview

Two related UI improvements:
1. Make session delete button always visible (instead of hover-only)
2. Redesign Settings as a full-screen overlay with tabbed navigation, including per-repository management with delete capability

## Feature 1: Session Delete Button (Always Visible)

### Current State
- `SessionItem.tsx` has a delete button that only appears on hover (`opacity-0 group-hover:opacity-100`)
- Delete flow: click X → inline confirm (Yes/No) → `onDelete(sessionId)` → `AppLayout.handleDeleteSession` → `client.deleteSession()`
- Right-click context menu with Delete option also exists

### Changes
- **File:** `packages/client/src/components/layout/SessionItem.tsx`
- Remove `opacity-0 group-hover:opacity-100` from the delete button — make it always visible
- Keep icon small and muted (gray) to avoid visual clutter
- No changes to delete logic, confirm dialog, context menu, or parent handling

## Feature 2: Settings Full-Screen Overlay with Tabs

### Layout

```
┌──────────────────────────────────────────────┐
│  ← Settings                        [X close] │
├──────────┬───────────────────────────────────┤
│          │                                   │
│ General  │     (content area)                │
│          │                                   │
│ ──────── │                                   │
│ Repos    │                                   │
│  C claude│                                   │
│  F fundi │                                   │
│  L litel │                                   │
│  D dotfi │                                   │
│  M matri │                                   │
│          │                                   │
└──────────┴───────────────────────────────────┘
```

### Behavior
- Full-screen overlay covering entire window including sidebar (`fixed inset-0 z-50`)
- Top header bar with "Settings" title and close (X) button
- Left sidebar navigation with:
  - **General** tab (single item)
  - **Repositories** group header (non-clickable label)
    - Each repository as a sub-tab with first-letter avatar + name
- Right content area renders based on selected tab

### General Tab Content
All existing Settings page content:
- Current Connection card
- About section (version, update channel, check for updates) — macOS only
- Server Configuration (reposPath, worktreesPath)
- Remote Servers list

No changes to existing functionality, just moved into the new layout.

### Repository Tab Content
When a repository is selected:

**Info section (read-only):**
- Repository name (heading)
- Path
- Remote URL (if available)
- Default branch

**Danger Zone (bottom, red-bordered card):**
- "Delete Repository" button (red/destructive)
- Click triggers confirm dialog: "Are you sure you want to delete {repo name}?" + Cancel / Delete buttons
- On delete: call `client.deleteRepository(id)`, remove from state, switch to General tab

## Files to Create/Modify

### Modified
- `packages/client/src/components/layout/SessionItem.tsx` — always-visible delete button
- `packages/client/src/pages/SettingsPage.tsx` — refactor into full-screen overlay with tab layout
- `packages/client/src/components/layout/AppLayout.tsx` — pass repositories data to Settings, add handleDeleteRepository

### New (components extracted from SettingsPage)
- `packages/client/src/pages/settings/SettingsGeneralTab.tsx` — existing settings content
- `packages/client/src/pages/settings/SettingsRepositoryTab.tsx` — repo detail + delete
- `packages/client/src/pages/settings/SettingsSidebar.tsx` — left navigation with tabs

## Data Dependencies
- Repositories list: already loaded in `AppLayout` state
- `client.deleteRepository(id)`: already exists in SDK
- `client.deleteSession(id)`: already exists, no changes needed
