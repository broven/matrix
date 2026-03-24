# Server Selection in Add Repository Dialogs

## Problem

When multiple servers are connected, "Open Project" and "Clone from URL" always target the local sidecar server. Users need to choose which server to add/clone repositories on.

## Design

### UI

- Inline `<Select>` dropdown at the top of both dialogs, below the title
- **Hidden when only 1 server** is connected (no UI change for single-server users)
- Shows server name + connection indicator
- data-testid: `server-select`

### Default Selection Logic

Always last-used:
1. Read `matrix:lastAddRepoServerId` from storage
2. If that server is currently connected → select it
3. Else if sidecar is connected → select sidecar
4. Else → first connected server

### Persistence

Single key `matrix:lastAddRepoServerId` in Tauri store / localStorage (same layer as `useServerStore`).

### New Hook: `useAddRepoServerSelect`

Location: `packages/client/src/hooks/useAddRepoServerSelect.tsx`

```ts
interface ServerOption {
  id: string;
  name: string;
  client: MatrixClient;
}

interface UseAddRepoServerSelectResult {
  servers: ServerOption[];
  selectedServerId: string;
  setSelectedServerId: (id: string) => void;
  selectedClient: MatrixClient | null;
  showSelector: boolean; // servers.length > 1
}
```

Sources:
- `useMatrixClient()` → sidecar client + status
- `useMatrixClients()` → remote clients + statuses
- `useServerStore()` → server metadata (names)

### Component Changes

1. **`OpenProjectDialog`** — add hook, render server select, use `selectedClient` for PathInput + addRepository
2. **`CloneFromUrlDialog`** — add hook, render server select, use `selectedClient` for clone/validate/browse
3. **`AppLayout`** — stop hardcoding sidecar client for dialogs; pass `onAdd` callback that uses the dialog's chosen server

### New Shared Component: `ServerSelect`

Location: `packages/client/src/components/ui/server-select.tsx`

Simple select component that renders the server dropdown, reusable by both dialogs.

## Implementation Steps

1. Create `useAddRepoServerSelect` hook with persistence
2. Create `ServerSelect` UI component
3. Integrate into `OpenProjectDialog`
4. Integrate into `CloneFromUrlDialog`
5. Update `AppLayout` to support dynamic client selection
6. Add data-testid attributes
