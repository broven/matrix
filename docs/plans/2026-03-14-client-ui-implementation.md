# Client UI Redesign — Implementation Plan

Design doc: `docs/plans/2026-03-14-client-ui-redesign.md`

## Step 1: Install Tailwind CSS v4 + shadcn/ui foundation

**Goal:** Get Tailwind + shadcn working in the Vite project.

**Files to create/modify:**
- `packages/client/package.json` — add tailwindcss, @tailwindcss/vite, class-variance-authority, clsx, tailwind-merge, lucide-react
- `packages/client/tsconfig.json` — add `"baseUrl": ".", "paths": { "@/*": ["./src/*"] }` for shadcn path alias
- `packages/client/vite.config.ts` — add tailwindcss plugin, add resolve alias for `@/`
- `packages/client/src/index.css` — replace with Tailwind v4 `@import "tailwindcss"` + CSS variable theme (shadcn format)
- `packages/client/components.json` — shadcn config file
- `packages/client/src/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)

**Commands:**
```bash
cd packages/client
pnpm add tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react
pnpm add -D @types/node
```

Then init shadcn:
```bash
pnpm dlx shadcn@latest init
```

**Verification:** `pnpm dev` starts without errors, Tailwind classes work.

---

## Step 2: Add shadcn/ui components needed

**Goal:** Install all shadcn primitives we'll use.

**Commands:**
```bash
pnpm dlx shadcn@latest add button card input textarea select separator scroll-area sheet badge collapsible alert avatar dropdown-menu tooltip
```

This creates files under `src/components/ui/`.

**Verification:** Import any component in a test file, confirm build passes.

---

## Step 3: ThemeProvider — system dark/light mode

**Goal:** Detect `prefers-color-scheme`, toggle `dark` class on `<html>`.

**Files to create:**
- `src/components/ThemeProvider.tsx`

**Implementation:**
```tsx
// Uses useEffect + matchMedia to sync system preference to <html> class
// No user toggle needed — purely follows system
```

**Files to modify:**
- `src/main.tsx` — wrap App with ThemeProvider
- `src/index.css` — add dark mode CSS variables in `.dark` selector (shadcn handles most via CSS vars)

**Verification:** Toggle system appearance → UI switches theme.

---

## Step 4: AppLayout — sidebar + content shell

**Goal:** Replace 3-page routing with a 2-state app: disconnected (ConnectPage) vs connected (sidebar + chat).

**Files to create:**
- `src/components/layout/AppLayout.tsx` — main layout shell
- `src/components/layout/Sidebar.tsx` — session list + new session
- `src/components/layout/SessionItem.tsx` — single session row
- `src/components/layout/MobileHeader.tsx` — hamburger + session name for mobile
- `src/components/layout/ChatHeader.tsx` — session info bar

**Files to modify:**
- `src/App.tsx` — remove BrowserRouter/Routes, replace with:
  ```tsx
  if (!client) return <ConnectPage />
  return <AppLayout />
  ```
  Use useState for selectedSessionId instead of URL routing.

**AppLayout structure:**
```tsx
<div className="flex h-screen">
  {/* Desktop sidebar */}
  <aside className="hidden md:flex w-[280px] border-r flex-col">
    <Sidebar />
  </aside>

  {/* Mobile: Sheet from shadcn (slide-out drawer) */}
  <Sheet>
    <SheetContent side="left">
      <Sidebar />
    </SheetContent>
  </Sheet>

  {/* Main content */}
  <main className="flex-1 flex flex-col">
    <MobileHeader />  {/* only visible on mobile */}
    {selectedSessionId ? <SessionView /> : <EmptyState />}
  </main>
</div>
```

**State management:**
- Lift `selectedSessionId` to AppLayout
- Lift `sessions` and `agents` lists to AppLayout (fetched on mount)
- Pass down via props (no need for context — single level)

**Verification:** Desktop shows sidebar + content. Mobile shows hamburger → slide-out. Switching sessions works.

---

## Step 5: Sidebar implementation

**Goal:** Session list with search, new session creation.

**Files:** `src/components/layout/Sidebar.tsx`, `src/components/layout/SessionItem.tsx`

**Sidebar structure:**
```
- Header: "Matrix" + connection status Badge
- ScrollArea with session items
  - Each SessionItem: name, agent, relative time, active indicator
  - Selected item highlighted
- Footer: "New Session" button → expand inline form
  - Select (agent) + Input (cwd) + Button (create)
```

**Data flow:**
- Sidebar receives: `sessions`, `agents`, `selectedSessionId`, `onSelectSession`, `onCreateSession`
- SessionItem: click → onSelectSession(id), on mobile also close Sheet

**Verification:** Sessions display, click switches, new session creates and auto-selects.

---

## Step 6: Rewrite ConnectPage with shadcn

**Goal:** Polished connect page using Card, Input, Button.

**Files to modify:**
- `src/pages/ConnectPage.tsx` — rewrite JSX with shadcn components

**Layout:**
```
Centered Card (max-w-lg)
  - Title: "Matrix" (text-2xl font-bold)
  - Subtitle: "Connect to your ACP Server"
  - Form: Input (server URL) + Input (token, type=password) + Button
  - Status Badge
  - QR section: Card with QR image + connection info
```

**Keep:** All existing logic (QR generation, URL params, sessionStorage restore).
**Replace:** All inline styles with Tailwind classes, all native elements with shadcn components.

**Verification:** Connect page renders correctly, connection works, QR displays.

---

## Step 7: Rewrite SessionView (chat area)

**Goal:** Replace SessionPage with a non-routed SessionView component.

**Files to create:**
- `src/components/chat/SessionView.tsx` — main chat container (replaces SessionPage)
- `src/components/chat/StatusBar.tsx` — animated status indicator

**Files to modify:**
- `src/components/MessageList.tsx` — restyle with Tailwind (user bubbles right, agent left)
- `src/components/PromptInput.tsx` — rewrite with shadcn Textarea + Button

**SessionView structure:**
```tsx
<div className="flex flex-col h-full">
  <ChatHeader session={sessionInfo} isProcessing={isProcessing} />
  <ScrollArea className="flex-1">
    <MessageList events={events} onApprove={...} onReject={...} />
  </ScrollArea>
  <StatusBar status={isProcessing ? "working" : "idle"} />
  <PromptInput onSend={handleSend} disabled={isProcessing} />
</div>
```

**StatusBar animation:**
```css
/* Working: gradient flow animation */
@keyframes status-flow {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.status-bar-working {
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--primary), transparent);
  background-size: 200% 100%;
  animation: status-flow 2s ease-in-out infinite;
}
```

**Keep:** All session subscription logic, event handling, history loading from SessionPage.
**Remove:** react-router-dom dependency (useParams, useNavigate) from session view.

**Verification:** Chat loads, messages display styled, status bar animates, input works.

---

## Step 8: Restyle MessageList — user/agent bubbles + markdown

**Goal:** User messages right-aligned with primary tint, agent messages left with card style.

**Files to modify:**
- `src/components/MessageList.tsx`

**User message:**
```tsx
<div className="flex justify-end">
  <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary/10 dark:bg-primary/20 px-4 py-2 text-sm">
    {text.slice(2)} {/* remove "> " prefix */}
  </div>
</div>
```

**Agent message:**
```tsx
<div className="flex justify-start">
  <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-card border px-4 py-2 text-sm markdown-content">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
  </div>
</div>
```

**Markdown styles:** Move from inline `<style>` tag to `index.css` with Tailwind-compatible dark mode variants.

**Verification:** Messages display as bubbles, markdown renders correctly in both themes.

---

## Step 9: Restyle ToolCallCard with shadcn Collapsible + Card

**Files to modify:**
- `src/components/ToolCallCard.tsx`

**Design:**
```tsx
<Collapsible>
  <Card className="my-2">
    <CollapsibleTrigger className="w-full">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant}>{status}</Badge>
          <span className="font-medium text-sm">{kind}: {title}</span>
        </div>
        <ChevronDown className="h-4 w-4" />
      </div>
    </CollapsibleTrigger>
    <CollapsibleContent>
      {/* locations + diffs */}
    </CollapsibleContent>
  </Card>
</Collapsible>
```

**Verification:** Tool calls show as collapsible cards, diffs render.

---

## Step 10: Restyle PermissionCard — 3-button design

**Files to modify:**
- `src/components/PermissionCard.tsx`

**Design:**
```tsx
<Alert variant="warning" className="my-2 border-2 border-amber-500">
  <AlertTitle>Permission Required: {kind} — {title}</AlertTitle>
  <AlertDescription>
    {/* diff/text content */}
  </AlertDescription>
  <div className="flex gap-2 mt-3">
    {allowAlways && <Button variant="default" onClick={...}>Always Allow</Button>}
    {allowOnce && <Button variant="outline" onClick={...}>Allow Once</Button>}
    {reject && <Button variant="destructive" onClick={...}>Deny</Button>}
  </div>
</Alert>
```

**Change:** Show all permission options (allow_always, allow_once, reject_once, reject_always) as separate buttons instead of just approve/reject.

**Verification:** Permission cards display with all option buttons, clicking works.

---

## Step 11: Restyle PlanView + PromptInput

**PlanView:**
- Use shadcn Card with CheckCircle2/Circle/Loader2 icons from lucide-react
- Color by status using Tailwind text classes

**PromptInput:**
- shadcn Textarea (auto-resize) + Button with Send icon
- `flex gap-2 p-4 border-t bg-background`

**Verification:** Plan renders with icons, input area looks polished.

---

## Step 12: Polish — fonts, animations, final dark mode pass

**Files to modify:**
- `packages/client/index.html` — add Inter + JetBrains Mono from Google Fonts (or bundle)
- `src/index.css` — set font-family, verify all dark mode variables
- Diff viewer styles — update for dark mode (`.dark .diff-line--added { ... }`)

**Animations:**
- Message fade-in: `animate-in fade-in-0 slide-in-from-bottom-2` (Tailwind animate)
- Sidebar slide: handled by shadcn Sheet
- Status bar: CSS keyframe (already defined in step 7)

**Verification:** Both themes look correct, fonts load, animations are smooth.

---

## Step 13: Remove old code + cleanup

**Files to delete:**
- `src/pages/DashboardPage.tsx` (merged into Sidebar)
- `src/components/ConnectionStatusBar.tsx` (replaced by sidebar status + chat header)

**Files to modify:**
- `src/App.tsx` — remove react-router-dom imports, remove old routes
- `package.json` — potentially remove react-router-dom if no longer needed

**Verification:** Build passes with no dead imports. `pnpm build` succeeds. App works end-to-end.

---

## Dependency Summary

**New packages:**
- `tailwindcss`, `@tailwindcss/vite` — styling
- `class-variance-authority`, `clsx`, `tailwind-merge` — shadcn utils
- `lucide-react` — icons
- `@types/node` (devDep) — for path alias

**Potentially removable:**
- `react-router-dom` — if we switch to state-based navigation (no URL routing)

## File Structure After

```
src/
├── main.tsx
├── App.tsx                          (simplified: ConnectPage or AppLayout)
├── index.css                        (Tailwind v4 + theme vars + markdown + diff styles)
├── lib/
│   └── utils.ts                     (cn helper)
├── hooks/
│   └── useMatrixClient.tsx          (unchanged)
├── pages/
│   └── ConnectPage.tsx              (restyled with shadcn)
├── components/
│   ├── ui/                          (shadcn components — auto-generated)
│   ├── layout/
│   │   ├── AppLayout.tsx
│   │   ├── Sidebar.tsx
│   │   ├── SessionItem.tsx
│   │   ├── MobileHeader.tsx
│   │   └── ChatHeader.tsx
│   ├── chat/
│   │   ├── SessionView.tsx
│   │   └── StatusBar.tsx
│   ├── ThemeProvider.tsx
│   ├── MessageList.tsx              (restyled)
│   ├── ToolCallCard.tsx             (restyled)
│   ├── PermissionCard.tsx           (restyled, 3 buttons)
│   ├── PlanView.tsx                 (restyled)
│   └── PromptInput.tsx              (restyled)
└── (DashboardPage.tsx DELETED)
└── (ConnectionStatusBar.tsx DELETED)
```
