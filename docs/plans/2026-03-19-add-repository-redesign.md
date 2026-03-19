# Add Repository Redesign

## Overview

Redesign the "Add Repository" flow to support two distinct operations (open local project vs clone from URL), multi-server selection with persisted defaults, and a server-side file explorer for browsing remote filesystems.

## Prerequisites

Git is a system-level prerequisite for Matrix. It must be installed on any server machine. Document this in the README.

## Entry Point

Replace the current single "Add Repository" button with a dropdown menu:

```
Sidebar:
  ┌──────────────────────┐
  │  + Add Repository  ▾ │  ← click or hover
  ├──────────────────────┤
  │  📂 Open Project     │  → opens Open Project dialog
  │  🔗 Clone from URL   │  → opens Clone from URL dialog
  └──────────────────────┘
```

Two separate, focused dialogs instead of one combined dialog.

## Open Project Dialog

```
┌──────────────────────────────────────────┐
│  Open Project                         ✕  │
├──────────────────────────────────────────┤
│  Server: [ local-server          ▾ ]     │
│                                          │
│  Path: [/home/user/projects/matrix] [📂] │
│                                          │
│  Display name: [ matrix-client     ]     │
├──────────────────────────────────────────┤
│                  [Cancel]  [Open Project] │
└──────────────────────────────────────────┘
```

- **Server selector** at top, defaults to last-used server (persisted)
- **Path input**: type/paste directly, or click 📂 to open File Explorer dialog
- **Display name**: auto-fills from path basename, user can override
- Validation: checks if path is a valid git repo on submit, shows warning if not

## Clone from URL Dialog

```
┌──────────────────────────────────────────┐
│  Clone from URL                       ✕  │
├──────────────────────────────────────────┤
│  Server: [ local-server          ▾ ]     │
│                                          │
│  URL: [git@github.com:user/repo.git  ]   │
│                                          │
│  ▶ Advanced options                      │
├──────────────────────────────────────────┤
│                     [Cancel]  [Clone]     │
└──────────────────────────────────────────┘
```

Advanced options (collapsed by default):

```
│  ▼ Advanced options                      │
│                                          │
│  Target: [/home/user/projects/repos] [📂]│
│  Branch: [                           ]   │
```

- **URL** is the only required field
- **Target** pre-filled with `{server repos path}/{repo name parsed from URL}`
- **Branch** empty = default branch
- **📂** reuses the File Explorer dialog
- **First clone on a server** shows a one-time notice: "Repos will be cloned to ~/projects/repos. Change in Settings."
- **Clone runs in background** — dialog closes immediately, repo appears in sidebar with a "cloning..." status indicator. Large repos don't block the UI.

## File Explorer Dialog (reusable)

```
┌──────────────────────────────────────────┐
│  Select Directory                     ✕  │
├──────────────────────────────────────────┤
│  [/home/user/projects/repos      ] [..↑] │
├──────────────────────────────────────────┤
│  │ 🔶 matrix-client       (git repo)  │  │
│  │ 🔶 superset             (git repo)  │  │
│  │ 📁 experiments                      │  │
│  │ 📁 archived                         │  │
│  │                                     │  │
│  │                                     │  │
├──────────────────────────────────────────┤
│                    [Cancel]  [Select]     │
└──────────────────────────────────────────┘
```

- **Separate dialog** — not embedded in the main dialogs
- **Reusable** — used by Open Project, Clone target dir, and Server Settings path config
- **Path bar** at top: editable, `..↑` button navigates up
- **Git repo indicators**: directories that are git repos get a distinct icon/badge
- **Navigation**: single-click folder navigates in, single-click git repo selects it
- **Start location**: server's configured repos path, falls back to `~`
- **Server-side**: all browsing happens via server API (works for both local and remote servers)

## Server Settings (per-server config)

New section in the Settings page for each server:

```
┌──────────────────────────────────────────┐
│  Server: local-server                    │
├──────────────────────────────────────────┤
│  Project Paths                           │
│                                          │
│  Repos:      [~/projects/repos     ] [📂]│
│  Worktrees:  [~/projects/worktrees ] [📂]│
│                                          │
└──────────────────────────────────────────┘
```

- Each server has independent path config
- **Defaults**: `~/Projects/repos` and `~/Projects/worktrees` (auto-detected on first server connection)
- **Browse button** reuses File Explorer dialog
- These paths are used as defaults for:
  - Clone target directory
  - Open Project file explorer start location
  - Worktree creation

## Last-Used Server Persistence

- When user adds a repo (either mode), remember which server they selected
- Next time they open either dialog, that server is pre-selected
- Stored client-side (localStorage or similar)

## Server-Side API

### New Endpoints

1. **`GET /api/fs/list?path=/some/dir`**
   - List directory contents on the server filesystem
   - Returns: `{ entries: [{ name, path, isDir, isGitRepo }] }`
   - Used by the File Explorer dialog

2. **`POST /api/repositories/clone`**
   - Body: `{ url, targetDir?, branch? }`
   - Starts clone in background, returns immediately with a task/job ID
   - Progress can be queried or pushed via WebSocket

3. **`GET /api/server/config`** / **`PUT /api/server/config`**
   - Get/set server-level configuration
   - Includes: default repos path, worktrees path

## Implementation Components

### Frontend (packages/client)
- `AddRepositoryMenu` — dropdown menu on the sidebar button
- `OpenProjectDialog` — dialog for adding local directory
- `CloneFromUrlDialog` — dialog for cloning
- `FileExplorerDialog` — reusable server-side file browser
- Server settings section in `SettingsPage`

### Backend (packages/server)
- `GET /api/fs/list` — filesystem listing endpoint
- `POST /api/repositories/clone` — background clone endpoint
- `GET/PUT /api/server/config` — server config endpoints
- Background clone job management (spawn `git clone`, track progress)

### Protocol (packages/protocol)
- `FsListRequest` / `FsListResponse` types
- `CloneRepositoryRequest` / `CloneRepositoryResponse` types
- `ServerConfig` type (repos path, worktrees path)
- Updated `AddRepositoryRequest` if needed
