# File Mentions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `@` file mentions to the chat input — popover with fuzzy search, inline pills, sent as ACP `ResourceLink` content blocks.

**Architecture:** New server endpoint returns `git ls-files` for a session's worktree. Frontend `PromptInput` gains `@`-trigger popover + pill management via a `useFileMention` hook. The `PromptContent` union type and `ClientMessage` prompt type are widened to include `resource_link`. The ACP bridge `sendPrompt` passes `resource_link` blocks through to the agent.

**Tech Stack:** React, TypeScript, Hono.js, Vitest, `git ls-files`

---

### Task 1: Add `resource_link` to protocol types

**Files:**
- Modify: `packages/protocol/src/session.ts:24-26`
- Modify: `packages/protocol/src/transport.ts:34`

**Step 1: Add `resource_link` to `PromptContent` union**

In `packages/protocol/src/session.ts`, change the `PromptContent` type:

```typescript
/** Prompt content can be text, a resource, or a resource link */
export type PromptContent =
  | { type: "text"; text: string; agentId?: string; profileId?: string }
  | { type: "resource"; resource: PromptResource }
  | { type: "resource_link"; name: string; uri: string; mimeType?: string };
```

**Step 2: Widen `ClientMessage` prompt type**

In `packages/protocol/src/transport.ts`, change line 34:

```typescript
  | { type: "session:prompt"; sessionId: string; prompt: PromptContent[] }
```

Add the import at the top of the file:
```typescript
import type { PromptContent } from "./session.js";
```

**Step 3: Verify types compile**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/protocol/src/session.ts packages/protocol/src/transport.ts
git commit -m "feat(protocol): add resource_link to PromptContent and ClientMessage types"
```

---

### Task 2: Widen `sendPrompt` in ACP bridge and server handler

**Files:**
- Modify: `packages/server/src/acp-bridge/index.ts:129`
- Modify: `packages/server/src/index.ts:97`
- Modify: `packages/server/src/index.ts:187-189`

**Step 1: Widen `sendPrompt` parameter type**

In `packages/server/src/acp-bridge/index.ts`, change the `sendPrompt` signature at line 129:

```typescript
async sendPrompt(sessionId: SessionId, prompt: PromptContent[]): Promise<unknown> {
```

Add the import at the top:
```typescript
import type { PromptContent } from "@matrix/protocol";
```

The method body stays the same — it already passes `prompt` through to JSON-RPC unchanged.

**Step 2: Widen `handlePrompt` parameter type**

In `packages/server/src/index.ts`, change `handlePrompt` at line 97:

```typescript
async function handlePrompt(sessionId: string, prompt: PromptContent[]) {
```

Add `PromptContent` to the import from `@matrix/protocol`.

**Step 3: Update history recording to handle non-text blocks**

In `packages/server/src/index.ts`, the loop at lines 187-191 only records `text` blocks. Update it to also record `resource_link` mentions in the user message:

```typescript
  // Build a combined user message text including any file mentions
  const textParts: string[] = [];
  for (const item of prompt) {
    if (item.type === "text") {
      textParts.push(item.text);
    } else if (item.type === "resource_link") {
      textParts.push(`@${item.name}`);
    }
  }
  if (textParts.length > 0) {
    store.appendHistory(sessionId, "user", textParts.join(""));
  }
```

**Step 4: Verify types compile**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/server/src/acp-bridge/index.ts packages/server/src/index.ts
git commit -m "feat(server): widen sendPrompt and handlePrompt to accept PromptContent[]"
```

---

### Task 3: Add `GET /sessions/:id/files` server endpoint

**Files:**
- Modify: `packages/server/src/api/rest/sessions.ts`

**Step 1: Add the files endpoint**

In `packages/server/src/api/rest/sessions.ts`, add a new route after the existing `GET /sessions/:id/history` route:

```typescript
  app.get("/sessions/:id/files", async (c) => {
    const sessionId = c.req.param("id");
    const session = store.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const cwd = session.cwd;
    if (!cwd) {
      return c.json([]);
    }

    try {
      const proc = Bun.spawn(["git", "ls-files"], { cwd, stdout: "pipe", stderr: "pipe" });
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      const files = text.trim().split("\n").filter(Boolean);
      return c.json(files);
    } catch {
      return c.json([]);
    }
  });
```

**Step 2: Verify it compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/server/src/api/rest/sessions.ts
git commit -m "feat(server): add GET /sessions/:id/files endpoint using git ls-files"
```

---

### Task 4: Add `getSessionFiles` to SDK client

**Files:**
- Modify: `packages/sdk/src/client.ts`

**Step 1: Add the method**

In `packages/sdk/src/client.ts`, add a new method in the "Session helpers" section (after `deleteSession`, around line 146):

```typescript
  async getSessionFiles(sessionId: string): Promise<string[]> {
    const res = await this.fetch(`/sessions/${sessionId}/files`);
    if (!res.ok) {
      throw new Error(`Failed to get session files: ${res.status}`);
    }
    return res.json();
  }
```

**Step 2: Verify it compiles**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/sdk/src/client.ts
git commit -m "feat(sdk): add getSessionFiles method to MatrixClient"
```

---

### Task 5: Widen `promptWithContent` in SDK session

**Files:**
- Modify: `packages/sdk/src/session.ts:55-62`

**Step 1: Update the type cast**

In `packages/sdk/src/session.ts`, the `promptWithContent` method at line 55 casts `content` to `Array<{ type: string; text: string }>`. Remove the cast since `ClientMessage` now accepts `PromptContent[]`:

```typescript
  promptWithContent(content: PromptContent[], callbacks: PromptCallbacks): void {
    this.subscribe();
    this.callbacks = callbacks;
    this.transport.send({
      type: "session:prompt",
      sessionId: this.sessionId,
      prompt: content,
    });
  }
```

**Step 2: Verify it compiles**

Run: `cd packages/sdk && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/sdk/src/session.ts
git commit -m "feat(sdk): remove narrow type cast in promptWithContent"
```

---

### Task 6: Create `useFileMention` hook

**Files:**
- Create: `packages/client/src/hooks/useFileMention.ts`

**Step 1: Create the hook**

Create `packages/client/src/hooks/useFileMention.ts`:

```typescript
import { useState, useEffect, useCallback, useMemo } from "react";

export interface FileMention {
  /** Unique ID for this mention instance */
  id: string;
  /** Relative file path */
  path: string;
  /** Display name (filename) */
  name: string;
  /** Position in the text where the @ was typed */
  insertPosition: number;
}

interface UseFileMentionOptions {
  /** All files available for mention */
  files: string[];
  /** Current text in the input */
  text: string;
  /** Current cursor position */
  cursorPos: number;
}

interface UseFileMentionResult {
  /** Whether the popover should be visible */
  isOpen: boolean;
  /** Filtered file list based on query */
  filtered: string[];
  /** Current query string (after @) */
  query: string;
  /** Index of the @ that triggered the popover */
  atIndex: number;
  /** Currently selected index in the list */
  selectedIndex: number;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
}

export function useFileMention({ files, text, cursorPos }: UseFileMentionOptions): UseFileMentionResult {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Find the @ query: look backwards from cursor for "@"
  const textBeforeCursor = text.slice(0, cursorPos);
  const atIndex = textBeforeCursor.lastIndexOf("@");

  let query = "";
  let isActive = false;

  if (atIndex !== -1 && files.length > 0) {
    // Only activate if "@" is at start or preceded by whitespace
    if (atIndex === 0 || /\s/.test(textBeforeCursor[atIndex - 1])) {
      const afterAt = textBeforeCursor.slice(atIndex + 1);
      // Only activate if there's no space in the query (still typing the filename)
      if (!/\s/.test(afterAt)) {
        query = afterAt.toLowerCase();
        isActive = true;
      }
    }
  }

  const filtered = useMemo(() => {
    if (!isActive) return [];
    if (!query) return files.slice(0, 50); // Show first 50 when no query
    return files
      .filter((f) => f.toLowerCase().includes(query))
      .slice(0, 50);
  }, [isActive, query, files]);

  const isOpen = filtered.length > 0;

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [isOpen, filtered.length]);

  return {
    isOpen,
    filtered,
    query,
    atIndex,
    selectedIndex,
    setSelectedIndex,
  };
}
```

**Step 2: Verify it compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/client/src/hooks/useFileMention.ts
git commit -m "feat(client): add useFileMention hook for @ file autocomplete"
```

---

### Task 7: Add file mention UI to PromptInput

**Files:**
- Modify: `packages/client/src/components/PromptInput.tsx`

This is the main UI task. The `PromptInput` currently uses a plain `<textarea>` with `text` state as a string. We need to:

1. Add `@` detection using the `useFileMention` hook
2. Render a file popover (similar to the existing slash command dropdown)
3. When a file is selected, replace the `@query` text with a pill marker
4. Track mentions separately from text
5. On send, serialize text + mentions into `PromptContent[]`

**Step 1: Add new props and imports**

Add to the `Props` interface:
```typescript
  sessionId?: string;
  onSendContent?: (content: PromptContent[]) => void;
```

Add imports:
```typescript
import type { AvailableCommand, PromptContent } from "@matrix/protocol";
import { useFileMention, type FileMention } from "@/hooks/useFileMention";
import { File } from "lucide-react";
```

**Step 2: Add file state and hook**

Inside the `PromptInput` component, add after the existing state:

```typescript
  const [files, setFiles] = useState<string[]>([]);
  const [mentions, setMentions] = useState<FileMention[]>([]);
  const fileDropdownRef = useRef<HTMLDivElement>(null);

  const fileMention = useFileMention({
    files,
    text,
    cursorPos,
  });
```

**Step 3: Fetch files when sessionId is provided**

Add an effect to fetch files:

```typescript
  useEffect(() => {
    if (!sessionId) return;
    // Lazy import to avoid circular deps — fetch via the server URL
    const fetchFiles = async () => {
      try {
        const res = await fetch(`/sessions/${sessionId}/files`, {
          headers: { Authorization: `Bearer ${window.__MATRIX_TOKEN__}` },
        });
        if (res.ok) {
          setFiles(await res.json());
        }
      } catch {
        // Silently fail — file mention just won't work
      }
    };
    fetchFiles();
  }, [sessionId]);
```

Actually, a cleaner approach — pass the files from `SessionView` via a new prop:

Change the approach. Add to Props:
```typescript
  files?: string[];
```

Remove the fetch effect, just use the prop directly:
```typescript
  const fileMention = useFileMention({
    files: files ?? [],
    text,
    cursorPos,
  });
```

**Step 4: Add file selection handler**

```typescript
  const selectFile = useCallback(
    (filePath: string) => {
      const name = filePath.split("/").pop() ?? filePath;
      const mentionId = `m_${Date.now()}`;
      const before = text.slice(0, fileMention.atIndex);
      const after = text.slice(cursorPos);
      // Insert a placeholder marker that we'll render as a pill
      const marker = `@[${filePath}]`;
      const newText = `${before}${marker} ${after}`;
      setText(newText);
      setCursorPos(before.length + marker.length + 1);
      setMentions((prev) => [
        ...prev,
        { id: mentionId, path: filePath, name, insertPosition: fileMention.atIndex },
      ]);
    },
    [text, cursorPos, fileMention.atIndex],
  );
```

**Step 5: Update handleSend to serialize ContentBlocks**

Replace the `handleSend` function:

```typescript
  const handleSend = () => {
    if (!text.trim()) return;

    if (onSendContent && mentions.length > 0) {
      // Parse text into ContentBlock[] splitting on @[filepath] markers
      const content = serializeContentBlocks(text, mentions, sessionCwd);
      onSendContent(content);
    } else {
      onSend(text);
    }
    setText("");
    setMentions([]);
  };
```

Add a helper function outside the component:

```typescript
/** Serialize text with @[path] markers into PromptContent[] */
function serializeContentBlocks(text: string, mentions: FileMention[], cwd?: string): PromptContent[] {
  const blocks: PromptContent[] = [];
  const mentionPaths = new Set(mentions.map((m) => m.path));
  // Match @[filepath] markers
  const regex = /@\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const filePath = match[1];
    if (!mentionPaths.has(filePath)) continue;

    // Text before this mention
    const before = text.slice(lastIndex, match.index);
    if (before) {
      blocks.push({ type: "text", text: before });
    }

    // The resource link
    const name = filePath.split("/").pop() ?? filePath;
    const uri = cwd ? `file://${cwd}/${filePath}` : `file:///${filePath}`;
    blocks.push({ type: "resource_link", name, uri });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last mention
  const remaining = text.slice(lastIndex);
  if (remaining) {
    blocks.push({ type: "text", text: remaining });
  }

  // Fallback: if no blocks were created, send as plain text
  if (blocks.length === 0) {
    blocks.push({ type: "text", text });
  }

  return blocks;
}
```

**Step 6: Update handleKeyDown to handle file mention popover**

Add file mention keyboard handling at the beginning of `handleKeyDown`, before the slash command check:

```typescript
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // File mention popover navigation
    if (fileMention.isOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        fileMention.setSelectedIndex((i) => (i + 1) % fileMention.filtered.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        fileMention.setSelectedIndex((i) => (i - 1 + fileMention.filtered.length) % fileMention.filtered.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectFile(fileMention.filtered[fileMention.selectedIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        const before = text.slice(0, fileMention.atIndex);
        const after = text.slice(cursorPos);
        setText(before + after);
        setCursorPos(fileMention.atIndex);
        return;
      }
    }

    // Existing slash command handling...
    if (isOpen) {
      // ... (unchanged)
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };
```

**Step 7: Render file mention popover**

Add the file popover in the JSX, right after the slash command dropdown (before the agent menu):

```tsx
          {fileMention.isOpen && (
            <div
              ref={fileDropdownRef}
              data-testid="file-mention-dropdown"
              className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
            >
              {fileMention.filtered.map((filePath, index) => {
                const name = filePath.split("/").pop() ?? filePath;
                const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/") + 1) : "";
                return (
                  <button
                    key={filePath}
                    type="button"
                    data-testid={`file-mention-item-${name}`}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                      index === fileMention.selectedIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50",
                    )}
                    onMouseEnter={() => fileMention.setSelectedIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectFile(filePath);
                    }}
                  >
                    <File className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm">
                      {dir && <span className="text-muted-foreground">{dir}</span>}
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
```

**Step 8: Scroll selected file item into view**

Add a useEffect similar to the slash command one:

```typescript
  useEffect(() => {
    if (!fileMention.isOpen || !fileDropdownRef.current) return;
    const item = fileDropdownRef.current.children[fileMention.selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [fileMention.isOpen, fileMention.selectedIndex]);
```

**Step 9: Verify it compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 10: Commit**

```bash
git add packages/client/src/components/PromptInput.tsx
git commit -m "feat(client): add @ file mention popover and pill markers to PromptInput"
```

---

### Task 8: Wire up SessionView to pass files and handle content blocks

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx`

**Step 1: Add file fetching state**

Add state for files inside `SessionView`:

```typescript
  const [sessionFiles, setSessionFiles] = useState<string[]>([]);
```

**Step 2: Fetch files when session is available**

Add an effect to fetch files using the SDK client:

```typescript
  useEffect(() => {
    if (!client || !sessionInfo.sessionId) return;
    client.getSessionFiles(sessionInfo.sessionId)
      .then(setSessionFiles)
      .catch(() => {}); // silently fail
  }, [client, sessionInfo.sessionId]);
```

**Step 3: Update handleSend to support ContentBlock[]**

Add a new handler for content blocks:

```typescript
  const handleSendContent = useCallback(
    (content: PromptContent[]) => {
      if (!session || viewStatus === "closed") return;
      if (!selectedAgentId) {
        setErrorMessage("Please select an agent before sending a message.");
        return;
      }

      // Build display text for the user message bubble
      const displayText = content
        .map((b) => (b.type === "text" ? b.text : `@${b.name}`))
        .join("");

      addEvent("message", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `> ${displayText}` },
      });

      // Tag the first text block with agentId/profileId
      const taggedContent = content.map((block, i) => {
        if (block.type === "text" && i === 0) {
          return { ...block, agentId: selectedAgentId, profileId: selectedProfileId ?? undefined };
        }
        return block;
      });

      if (isProcessing) {
        // For queued messages, fall back to text-only for now
        setMessageQueue((q) => [...q, { text: displayText, agentId: selectedAgentId, profileId: selectedProfileId }]);
        return;
      }

      setIsProcessing(true);
      setErrorMessage(null);

      const callbacks: PromptCallbacks = {
        onComplete: () => setIsProcessing(false),
      };

      session.promptWithContent(taggedContent, callbacks);
    },
    [addEvent, session, viewStatus, selectedAgentId, selectedProfileId, isProcessing],
  );
```

**Step 4: Pass new props to PromptInput**

Update the `<PromptInput>` JSX to include the new props:

```tsx
      <PromptInput
        onSend={handleSend}
        onSendContent={handleSendContent}
        files={sessionFiles}
        sessionCwd={sessionInfo.cwd}
        disabled={inputDisabled}
        placeholder={getInputPlaceholder(viewStatus, hasAgent, noAgentAvailable)}
        isProcessing={isProcessing}
        agents={agents}
        selectedAgentId={selectedAgentId}
        selectedProfileId={selectedProfileId}
        onAgentChange={setSelectedAgentId}
        onProfileChange={setSelectedProfileId}
        availableCommands={availableCommands}
        agentLocked={Boolean(sessionInfo.agentId && agents.some((a) => a.id === sessionInfo.agentId && a.available))}
        noAgentAvailable={noAgentAvailable}
      />
```

**Step 5: Add import for PromptContent**

```typescript
import type { PromptContent } from "@matrix/protocol";
```

**Step 6: Verify it compiles**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx
git commit -m "feat(client): wire SessionView to fetch files and send ContentBlock prompts"
```

---

### Task 9: Add `sessionCwd` prop to PromptInput for URI construction

**Files:**
- Modify: `packages/client/src/components/PromptInput.tsx`

**Step 1: Add `sessionCwd` to Props**

```typescript
  sessionCwd?: string;
```

**Step 2: Pass `sessionCwd` to `serializeContentBlocks`**

In `handleSend`, pass `sessionCwd`:
```typescript
      const content = serializeContentBlocks(text, mentions, sessionCwd);
```

This was already planned in Task 7 but listed separately as a reminder — if Task 7 already includes it, skip this task.

**Step 3: Commit (if needed)**

```bash
git add packages/client/src/components/PromptInput.tsx
git commit -m "feat(client): pass sessionCwd for file URI construction"
```

---

### Task 10: Add tests for useFileMention hook

**Files:**
- Create: `packages/client/src/hooks/useFileMention.test.ts`

**Step 1: Write tests**

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFileMention } from "@/hooks/useFileMention";

const files = [
  "src/main.ts",
  "src/app.tsx",
  "src/components/Button.tsx",
  "package.json",
  "README.md",
];

describe("useFileMention", () => {
  it("is not open when text has no @", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "hello", cursorPos: 5 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("opens when @ is typed at start", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "@", cursorPos: 1 }),
    );
    expect(result.current.isOpen).toBe(true);
    expect(result.current.filtered.length).toBeGreaterThan(0);
  });

  it("opens when @ is preceded by whitespace", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "look at @", cursorPos: 9 }),
    );
    expect(result.current.isOpen).toBe(true);
  });

  it("does not open when @ is inside a word", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "email@", cursorPos: 6 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("filters files by query", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "@main", cursorPos: 5 }),
    );
    expect(result.current.isOpen).toBe(true);
    expect(result.current.filtered).toEqual(["src/main.ts"]);
  });

  it("closes when space is typed after query", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "@main ", cursorPos: 6 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("returns empty when no files match", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "@zzzzz", cursorPos: 6 }),
    );
    expect(result.current.isOpen).toBe(false);
    expect(result.current.filtered).toEqual([]);
  });
});
```

**Step 2: Run tests**

Run: `cd packages/client && npx vitest run src/hooks/useFileMention.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/client/src/hooks/useFileMention.test.ts
git commit -m "test(client): add tests for useFileMention hook"
```

---

### Task 11: Add tests for file mention in PromptInput

**Files:**
- Modify: `packages/client/src/components/PromptInput.test.tsx`

**Step 1: Add file mention tests**

Append to the existing describe block:

```typescript
  it("shows file mention dropdown when typing @", () => {
    const files = ["src/main.ts", "src/app.tsx"];
    render(<PromptInput {...defaultProps} files={files} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });

    expect(screen.getByTestId("file-mention-dropdown")).toBeInTheDocument();
  });

  it("filters file mentions by query", () => {
    const files = ["src/main.ts", "src/app.tsx"];
    render(<PromptInput {...defaultProps} files={files} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "@main", selectionStart: 5 } });

    expect(screen.getByTestId("file-mention-item-main.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("file-mention-item-app.tsx")).not.toBeInTheDocument();
  });

  it("inserts file marker on Enter when file dropdown is open", () => {
    const onSend = vi.fn();
    const files = ["src/main.ts"];
    render(<PromptInput {...defaultProps} onSend={onSend} files={files} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toContain("@[src/main.ts]");
  });

  it("does not show file dropdown when no files prop", () => {
    render(<PromptInput {...defaultProps} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });

    expect(screen.queryByTestId("file-mention-dropdown")).not.toBeInTheDocument();
  });
```

**Step 2: Run tests**

Run: `cd packages/client && npx vitest run src/components/PromptInput.test.tsx`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/client/src/components/PromptInput.test.tsx
git commit -m "test(client): add PromptInput file mention tests"
```

---

### Task 12: Add `data-testid` attributes and final polish

**Files:**
- Modify: `packages/client/src/components/PromptInput.tsx` (if not already done in Task 7)

**Step 1: Verify data-testid attributes**

Ensure these `data-testid` values are present:
- `file-mention-dropdown` — the popover container
- `file-mention-item-{filename}` — each file item in the dropdown

These should already be in place from Task 7.

**Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 3: Commit (if any changes)**

```bash
git add -A
git commit -m "chore: add data-testid attributes for file mention e2e testing"
```

---

### Task 13: Verify end-to-end type chain compiles

**Step 1: Run full typecheck across all packages**

Run: `npx tsc --build`
Expected: No errors

If there are errors, fix them.

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All pass

**Step 3: Final commit if needed**

```bash
git add -A
git commit -m "fix: resolve type errors across packages"
```
