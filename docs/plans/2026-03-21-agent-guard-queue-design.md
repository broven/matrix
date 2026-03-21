# Agent Guard & Message Queue Design

## Problem

1. Users can send messages without selecting an agent — the message appears as "Thinking..." forever with no response
2. A previously selected default agent may have been uninstalled ("ghost agent"), leaving a stale reference
3. Input is disabled during agent processing, preventing users from drafting their next message

## Solution

Three changes:

### 1. No-agent guard (PromptInput + SessionView)

**When no agents are available** (`availableAgents.length === 0`):
- Disable textarea and send button in `PromptInput`
- Change placeholder to "No agents available. Go to Settings to install one."
- Show empty state card in chat area with message and a "Go to Settings" button

**When agents exist but none selected** (edge case, auto-select should prevent this):
- Send button disabled
- Placeholder: "Select an agent to start..."

### 2. Ghost agent detection (SessionView)

Add a check: if `selectedAgentId` is not found in the current `agents` list, reset it to `null`. This triggers the existing auto-select effect which will pick the default or first available agent.

```tsx
// After agents list updates, verify selected agent still exists
useEffect(() => {
  if (!selectedAgentId) return;
  const stillExists = agents.some((a) => a.id === selectedAgentId && a.available);
  if (!stillExists) {
    setSelectedAgentId(null);
    setSelectedProfileId(null);
  }
}, [agents, selectedAgentId]);
```

### 3. Allow input during processing + queue messages (PromptInput + SessionView)

**Input during processing:**
- Remove the `isProcessing` check from `inputDisabled`
- Textarea stays enabled while agent is responding
- User can type and edit their draft freely

**Message queue:**
- When user sends while `isProcessing === true`:
  - Message bubble appears immediately in chat with a "Queued" badge
  - Message is queued internally (array state)
  - When `onComplete` fires, automatically send the next queued message
- Queue is FIFO — multiple messages can be queued

**Queued message UI:**
- User message bubble appears at normal position in chat
- Small "Queued" label below the message bubble (muted text, similar to timestamp style)
- Once the queued message starts processing, the label disappears

## Files to modify

| File | Changes |
|------|---------|
| `packages/client/src/components/PromptInput.tsx` | Add `noAgentAvailable` prop; remove processing-disables-input |
| `packages/client/src/components/chat/SessionView.tsx` | Ghost agent check; queue logic; empty state; pass new props |
| `packages/client/src/components/MessageList.tsx` | Support "queued" indicator on user messages |

## Edge cases

- Zero agents installed → empty state + disabled input
- Ghost agent → auto-reset to null → auto-select picks new default or shows "no agent"
- User queues message then closes session → queued messages are discarded (session is closed)
- User queues multiple messages → FIFO processing, all show as "Queued" until their turn
