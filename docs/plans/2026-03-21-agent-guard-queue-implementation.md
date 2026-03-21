# Agent Guard & Message Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent sending messages without an agent, detect stale agent references, and allow message queueing during agent processing.

**Architecture:** Three independent features layered on SessionView and PromptInput. Ghost agent detection resets stale IDs to trigger existing auto-select. Message queue uses a ref-based FIFO that drains on `onComplete`. Empty state is a simple inline card in SessionView.

**Tech Stack:** React, TypeScript, Tailwind CSS, lucide-react icons

---

### Task 1: Ghost Agent Detection

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx:56-73`

**Step 1: Add ghost agent detection effect**

In `SessionView.tsx`, add a new `useEffect` right after the existing auto-select effect (line 73). This effect checks if the currently selected agent still exists in the agents list. If not, it resets `selectedAgentId` to `null`, which triggers the existing auto-select effect.

```tsx
// Place after line 73 (after the auto-select useEffect)
// Ghost agent detection: reset if selected agent was uninstalled
useEffect(() => {
  if (!selectedAgentId) return;
  const stillExists = agents.some((a) => a.id === selectedAgentId && a.available);
  if (!stillExists) {
    setSelectedAgentId(null);
    setSelectedProfileId(null);
  }
}, [agents, selectedAgentId]);
```

**Step 2: Verify build compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx
git commit -m "fix: detect and reset ghost agent references"
```

---

### Task 2: No-Agent Guard — Disable Input

**Files:**
- Modify: `packages/client/src/components/PromptInput.tsx:7-20,72-84,277-289,291-335`
- Modify: `packages/client/src/components/chat/SessionView.tsx:254-290`

**Step 1: Add `noAgentAvailable` prop to PromptInput**

In `PromptInput.tsx`, add the new prop to the `Props` interface and destructure it:

```tsx
// In Props interface (around line 7), add:
interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  isProcessing?: boolean;
  agents?: AgentListItem[];
  selectedAgentId: string | null;
  selectedProfileId: string | null;
  onAgentChange?: (agentId: string) => void;
  onProfileChange?: (profileId: string | null) => void;
  availableCommands?: AvailableCommand[];
  agentLocked?: boolean;
  noAgentAvailable?: boolean;  // <-- ADD THIS
}
```

Add to destructuring (around line 83):

```tsx
  agentLocked = false,
  noAgentAvailable = false,  // <-- ADD THIS
}: Props) {
```

**Step 2: Disable send button when no agent selected**

In `PromptInput.tsx`, update the send button's disabled condition (around line 322):

Change:
```tsx
disabled={disabled || !text.trim()}
```
To:
```tsx
disabled={disabled || !text.trim() || noAgentAvailable || (!selectedAgentId && !agentLocked)}
```

Also update the visual styling condition on line 325:

Change:
```tsx
text.trim() && !disabled
```
To:
```tsx
text.trim() && !disabled && !noAgentAvailable && (!!selectedAgentId || agentLocked)
```

**Step 3: Update textarea disabled state for no-agent case**

In `PromptInput.tsx`, the textarea disabled prop (around line 286):

Change:
```tsx
disabled={disabled}
```
To:
```tsx
disabled={disabled || noAgentAvailable}
```

**Step 4: Pass noAgentAvailable from SessionView**

In `SessionView.tsx`, compute `noAgentAvailable` and pass it:

Around line 254, add:
```tsx
const availableAgents = agents.filter((a) => a.available);
const noAgentAvailable = availableAgents.length === 0;
```

Update the placeholder logic — change the `getInputPlaceholder` function (lines 26-30):
```tsx
function getInputPlaceholder(status: ViewStatus, hasAgent: boolean, noAgentAvailable: boolean) {
  if (status === "closed") return "This session is closed.";
  if (noAgentAvailable) return "No agents available. Go to Settings to install one.";
  if (!hasAgent) return "Select an agent to start...";
  return "Ask to make changes, @mention files, run /commands";
}
```

Update the call to `getInputPlaceholder` (around line 281):
```tsx
placeholder={getInputPlaceholder(viewStatus, hasAgent, noAgentAvailable)}
```

Pass the new prop to PromptInput (add after `agentLocked` prop):
```tsx
noAgentAvailable={noAgentAvailable}
```

**Step 5: Verify build compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add packages/client/src/components/PromptInput.tsx packages/client/src/components/chat/SessionView.tsx
git commit -m "feat: disable input when no agent available or selected"
```

---

### Task 3: Empty State Card in Chat Area

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx:265-292`

**Step 1: Add onNavigateSettings prop and empty state UI**

Add a new prop to `SessionViewProps`:
```tsx
interface SessionViewProps {
  serverId: string;
  sessionInfo: SessionInfo;
  agents: AgentListItem[];
  onSessionInfoChange?: (sessionId: string, patch: Partial<SessionInfo>) => void;
  onNavigateSettings?: () => void;  // <-- ADD THIS
}
```

Update the destructuring:
```tsx
export function SessionView({ serverId, sessionInfo, agents, onSessionInfoChange, onNavigateSettings }: SessionViewProps) {
```

In the return JSX, add an empty state card inside the ScrollArea (before `<MessageList>`). The card shows when `noAgentAvailable` is true and there are no events (empty chat):

```tsx
<ScrollArea className="min-h-0 flex-1">
  {noAgentAvailable && events.length === 0 ? (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Bot className="size-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-medium">No agents available</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Install an agent in Settings to start chatting.
          </p>
        </div>
        {onNavigateSettings && (
          <button
            type="button"
            onClick={onNavigateSettings}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            data-testid="go-to-settings-btn"
          >
            Go to Settings
          </button>
        )}
      </div>
    </div>
  ) : (
    <>
      <MessageList events={events} onApprove={handleApprove} onReject={handleReject} />
      <div ref={messagesEndRef} />
    </>
  )}
</ScrollArea>
```

Add the `Bot` import at the top of the file:
```tsx
import { Bot } from "lucide-react";
```

**Step 2: Pass `onNavigateSettings` from AppLayout**

In `packages/client/src/components/layout/AppLayout.tsx`, find where `<SessionView>` is rendered and add the prop:

```tsx
<SessionView
  // ... existing props
  onNavigateSettings={() => setShowSettings(true)}
/>
```

**Step 3: Verify build compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx packages/client/src/components/layout/AppLayout.tsx
git commit -m "feat: show empty state card when no agents available"
```

---

### Task 4: Allow Input During Processing

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx:263`

**Step 1: Remove isProcessing from inputDisabled**

In `SessionView.tsx`, change line 263:

From:
```tsx
const inputDisabled = isProcessing || viewStatus === "closed";
```
To:
```tsx
const inputDisabled = viewStatus === "closed";
```

This allows the textarea to stay enabled while the agent is processing. The send button will still work (queue logic handles processing state in next task).

**Step 2: Verify build compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx
git commit -m "feat: allow typing in input while agent is processing"
```

---

### Task 5: Message Queue — Core Logic

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx:43-50,204-230,148-190`

**Step 1: Add queue state and ref**

In `SessionView.tsx`, add queue state after the existing state declarations (around line 53):

```tsx
const [messageQueue, setMessageQueue] = useState<string[]>([]);
const messageQueueRef = useRef<string[]>([]);
// Keep ref in sync for use in callbacks
messageQueueRef.current = messageQueue;
```

Also add a ref to track `selectedAgentId` and `selectedProfileId` for use in the drain callback:

```tsx
const selectedAgentIdRef = useRef(selectedAgentId);
selectedAgentIdRef.current = selectedAgentId;
const selectedProfileIdRef = useRef(selectedProfileId);
selectedProfileIdRef.current = selectedProfileId;
```

**Step 2: Add queue drain function**

Add a `drainQueue` function before `handleSend`:

```tsx
const drainQueue = useCallback(() => {
  const next = messageQueueRef.current[0];
  if (!next || !session) return;

  const agentId = selectedAgentIdRef.current;
  if (!agentId) return;

  // Remove from queue
  setMessageQueue((q) => q.slice(1));

  // Send the queued message
  setIsProcessing(true);
  setErrorMessage(null);

  const callbacks: PromptCallbacks = {
    onComplete: () => setIsProcessing(false),
  };

  session.promptWithContent(
    [{ type: "text", text: next, agentId, profileId: selectedProfileIdRef.current ?? undefined }],
    callbacks,
  );
}, [session]);
```

**Step 3: Modify handleSend to queue when processing**

Update `handleSend` (lines 204-230) to queue messages when already processing:

```tsx
const handleSend = useCallback(
  (text: string) => {
    if (!session || viewStatus === "closed") return;
    if (!selectedAgentId) {
      setErrorMessage("Please select an agent before sending a message.");
      return;
    }

    // Always show the user message immediately
    addEvent("message", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `> ${text}` },
    });

    if (isProcessing) {
      // Queue the message — it will be sent when current processing completes
      setMessageQueue((q) => [...q, text]);
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    const callbacks: PromptCallbacks = {
      onComplete: () => setIsProcessing(false),
    };

    session.promptWithContent(
      [{ type: "text", text, agentId: selectedAgentId, profileId: selectedProfileId ?? undefined }],
      callbacks,
    );
  },
  [addEvent, session, viewStatus, selectedAgentId, selectedProfileId, isProcessing],
);
```

**Step 4: Trigger queue drain on processing complete**

In the `onComplete` callback inside `subscribeToUpdates` (around line 166-174), add queue drain:

```tsx
onComplete: () => {
  setIsProcessing(false);
  setErrorMessage(null);
  onSessionInfoChange?.(sessionInfo.sessionId, {
    status: "active",
    lastActiveAt: new Date().toISOString(),
  });
  // Drain next queued message after a tick
  setTimeout(() => {
    if (messageQueueRef.current.length > 0) {
      drainQueue();
    }
  }, 0);
},
```

Make sure `drainQueue` is in the dependency array of the `useEffect` that sets up `subscribeToUpdates`.

**Step 5: Clear queue when session closes**

In the `onError` handler where terminal errors are handled (around line 178):

```tsx
if (isTerminalSessionError(error.code)) {
  setViewStatus("closed");
  setMessageQueue([]);  // <-- ADD THIS
  onSessionInfoChange?.(sessionInfo.sessionId, {
    status: "closed",
    closeReason: error.code,
  });
  return;
}
```

**Step 6: Verify build compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx
git commit -m "feat: add message queue for sending during agent processing"
```

---

### Task 6: Queued Message UI Indicator

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx` (pass queuedTexts to MessageList)
- Modify: `packages/client/src/components/MessageList.tsx:18,223,258-268`

**Step 1: Add queuedTexts prop to MessageList**

In `MessageList.tsx`, update the Props interface:

```tsx
interface Props {
  events: SessionEvent[];
  onApprove: (toolCallId: string, optionId: string) => void;
  onReject: (toolCallId: string, optionId: string) => void;
  queuedTexts?: Set<string>;  // <-- ADD THIS
}
```

Update the component signature:
```tsx
export function MessageList({ events, onApprove, onReject, queuedTexts }: Props) {
```

**Step 2: Show "Queued" label on queued user messages**

In `MessageList.tsx`, update the user message rendering (lines 261-268). The queued indicator checks if the message text (without the "> " prefix) is in the `queuedTexts` set:

```tsx
if (isOwnMessage) {
  const messageText = item.text.slice(2);
  const isQueued = queuedTexts?.has(messageText);
  return (
    <div key={item.key} className="flex flex-col items-end gap-1 animate-message-in" data-testid="message-item">
      <div className="max-w-[80%] rounded-[1.25rem] rounded-br-md bg-user-bubble px-4 py-2.5 text-[0.9375rem] leading-relaxed text-user-bubble-foreground">
        <p className="whitespace-pre-wrap">{messageText}</p>
      </div>
      {isQueued && (
        <span className="mr-1 text-xs text-muted-foreground" data-testid="queued-indicator">
          Queued
        </span>
      )}
    </div>
  );
}
```

**Step 3: Pass queuedTexts from SessionView**

In `SessionView.tsx`, create the `queuedTexts` set and pass it:

```tsx
const queuedTexts = new Set(messageQueue);
```

Update the `<MessageList>` call:
```tsx
<MessageList
  events={events}
  onApprove={handleApprove}
  onReject={handleReject}
  queuedTexts={queuedTexts}
/>
```

Note: Wrap `queuedTexts` in `useMemo` to avoid unnecessary re-renders:
```tsx
const queuedTexts = useMemo(() => new Set(messageQueue), [messageQueue]);
```

Add `useMemo` to the React import at the top of `SessionView.tsx`.

**Step 4: Verify build compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/client/src/components/MessageList.tsx packages/client/src/components/chat/SessionView.tsx
git commit -m "feat: show 'Queued' indicator on messages sent during processing"
```

---

### Task 7: Final Verification

**Step 1: Full type check**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 2: Build check**

Run: `cd packages/client && npm run build`
Expected: Build succeeds

**Step 3: Commit any remaining fixes**

If any issues were found, fix and commit.
