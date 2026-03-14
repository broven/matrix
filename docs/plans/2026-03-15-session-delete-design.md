# Session Delete — Design

## Overview

Add delete session support to the client's left sidebar session list.

## Interaction

1. **Hover icon**: A small `X` icon appears at the top-right corner of `SessionItem` on hover.
2. **Right-click context menu**: Right-clicking a session item shows a context menu with a "Delete" option (red/destructive styling).
3. **Inline confirmation**: Clicking delete (via either method) transforms the session item inline — showing "Delete session?" with "Yes" / "No" buttons. Pressing "No" or clicking elsewhere cancels.
4. **On confirm**:
   - Call `DELETE /sessions/:id`
   - Remove session from local state
   - If it was the selected session, auto-select the best remaining session (reuse existing sort logic)
   - Any status (active, suspended, closed) can be deleted

## Files to Modify

### 1. SDK — `packages/sdk/src/client.ts`

Add `deleteSession(sessionId: string)` method that calls `DELETE /sessions/:id`.

### 2. SessionItem — `packages/client/src/components/layout/SessionItem.tsx`

- Add hover state showing `X` icon at top-right
- Add `onContextMenu` handler for right-click menu
- Add inline confirmation state: "Delete session? Yes / No"
- New prop: `onDelete: (sessionId: string) => void`

### 3. Sidebar — `packages/client/src/components/layout/Sidebar.tsx`

- Pass `onDelete` prop through to `SessionItem`
- Render a simple context menu component (positioned at cursor)

### 4. AppLayout — `packages/client/src/components/layout/AppLayout.tsx`

- Add `handleDeleteSession` function:
  - Call `client.deleteSession(sessionId)`
  - Remove from `sessions` state
  - If deleted session was selected, run auto-select logic on remaining sessions
