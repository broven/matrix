# Client UI Redesign

## Overview

Redesign the Matrix ACP client from bare HTML/CSS to a polished, modern interface using **shadcn/ui + Tailwind CSS**. Support **system theme following** (light/dark) and **responsive layout** (desktop sidebar + mobile drawer).

## Tech Stack

- **shadcn/ui** — component library (copied into project, fully customizable)
- **Tailwind CSS v4** — utility-first styling
- **Inter** — UI font
- **JetBrains Mono** — code font
- **Framer Motion** or CSS transitions — animations

## Layout Architecture

### Desktop (≥768px)

```
┌──────────┬──────────────────────────────────┐
│ Sidebar  │  Chat Area                       │
│ (280px)  │                                  │
│          │  ┌────────────────────────────┐  │
│ Sessions │  │  Message List (scrollable) │  │
│ - Sess 1 │  │                            │  │
│ - Sess 2 │  │                            │  │
│          │  └────────────────────────────┘  │
│          │  ┌────────────────────────────┐  │
│ + New    │  │  Status Bar (pulse light)  │  │
│          │  ├────────────────────────────┤  │
│          │  │  Input Area                │  │
│          │  └────────────────────────────┘  │
└──────────┴──────────────────────────────────┘
```

- Sidebar fixed at 280px, always visible
- ConnectPage is full-screen (no sidebar) when not connected

### Mobile (<768px)

```
┌───────────────────────┐
│  ☰ Session Name    ⚙ │  ← hamburger menu top-left
│  ┌─────────────────┐  │
│  │  Message List   │  │
│  └─────────────────┘  │
│  ┌─────────────────┐  │
│  │  Status + Input │  │
│  └─────────────────┘  │
└───────────────────────┘
```

- Sidebar hidden by default, slides in from left on hamburger tap
- Semi-transparent overlay backdrop
- Auto-closes on session selection

## Sidebar Design

### Structure

- **Header**: App logo/name + connection status dot (green/yellow/red)
- **Search**: Filter sessions (visible when session count > 5)
- **Session List**: Scrollable list of sessions
  - Each item: session name, agent name, last active time
  - Selected: left accent bar + highlighted background
  - Active (agent working): animated pulse dot next to name
- **Footer**: Fixed "New Session" button
  - Expands to show agent selector dropdown + working directory input
  - Confirm creates session and auto-switches

## Chat Area

### Header Bar

- Session name (left)
- Agent name + live status indicator (right)

### Message List

- **User messages**: Right-aligned, primary color tinted background
- **Agent messages**: Left-aligned, card-style with markdown rendering
  - Code blocks with syntax highlighting
  - GFM support (tables, task lists, etc.)
- **Tool Call cards**: Collapsible cards showing tool name, status, diffs
  - Status color: blue (running), green (success), red (error)
- **Permission Request cards**: Inline in message flow
  - Amber/warning border for visibility
  - Shows the requested operation details
  - Three buttons: "Always Allow" (primary), "Allow Once" (outline), "Deny" (destructive/red)
  - After action: collapses to single line (✅ Allowed / ❌ Denied)

### Status Bar

Thin line between message list and input, indicating agent state:

- **Working**: Animated gradient line flowing left-to-right, primary color with glow
- **Idle**: Static muted line
- **Error**: Static red line

### Input Area

- Auto-expanding textarea
- Enter to send, Shift+Enter for newline
- Send button on the right
- Disabled while not connected

## Theme System

### Strategy

- Tailwind `darkMode: "class"` strategy
- Detect `prefers-color-scheme` on load, apply `dark` class to `<html>`
- Listen for changes and update dynamically
- shadcn/ui built-in dark mode support

### Color Palette

```
                    Light               Dark
──────────────────────────────────────────────────
Background          #ffffff             #0a0a0b
Sidebar             #f8f9fa             #111113
Card                #ffffff             #1a1a1e
Border              #e5e7eb             #27272a
Text                #111827             #fafafa
Muted text          #6b7280             #a1a1aa
Primary             #6366f1             #818cf8
Success             #22c55e             #4ade80
Warning             #f59e0b             #fbbf24
Danger              #ef4444             #f87171
```

### Visual Properties

- Border radius: `0.5rem` (shadcn default)
- Shadows: subtle in light mode, border-based in dark mode
- Font: Inter (UI), JetBrains Mono (code)
- Animations: status bar flow, sidebar slide, message fade-in — all 60fps CSS transitions

## Component Mapping

| Current Component      | New Implementation                          |
|------------------------|---------------------------------------------|
| App.tsx                | Layout shell with sidebar + content area    |
| ConnectPage.tsx        | Redesign with shadcn Card, Input, Button    |
| DashboardPage.tsx      | Merge into Sidebar (session list + new)     |
| SessionPage.tsx        | Chat area (messages + status + input)       |
| ConnectionStatusBar    | Sidebar header status dot + chat header     |
| MessageList            | Styled message bubbles with markdown        |
| ToolCallCard           | shadcn Collapsible + Card                   |
| PermissionCard         | shadcn Alert + Button group (3 options)     |
| PlanView               | shadcn Checkbox list                        |
| PromptInput            | shadcn Textarea + Button                    |

## New Components Needed

- `AppLayout` — main layout shell (sidebar + content)
- `Sidebar` — session list + new session form
- `SessionItem` — individual session in sidebar list
- `MobileDrawer` — slide-out sidebar for mobile
- `StatusBar` — animated status indicator line
- `ChatHeader` — session info bar at top of chat
- `MessageBubble` — styled user/agent message wrapper
- `ThemeProvider` — system theme detection + class toggle
