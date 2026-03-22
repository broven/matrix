# Image Send Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable sending images to ACP agents from the Matrix chat input via attach button, clipboard paste, and drag & drop.

**Architecture:** Extend `PromptContent` with an `image` type, add a shared `handleImageFiles()` pipeline in the client (validate → compress → base64 → preview), wire three input methods to it, and map to ACP `ImageContent` in the bridge layer. No persistence — images are in-memory only.

**Tech Stack:** React 19, Tiptap editor, Canvas API for compression, ACP JSON-RPC

---

### Task 1: Add `image` type to PromptContent

**Files:**
- Modify: `packages/protocol/src/session.ts:24-27`

**Step 1: Add the image variant to the PromptContent union**

In `packages/protocol/src/session.ts`, change lines 24-27 from:

```typescript
export type PromptContent =
  | { type: "text"; text: string; agentId?: string; profileId?: string }
  | { type: "resource"; resource: PromptResource }
  | { type: "resource_link"; name: string; uri: string; mimeType?: string };
```

to:

```typescript
export type PromptContent =
  | { type: "text"; text: string; agentId?: string; profileId?: string }
  | { type: "image"; data: string; mimeType: string; name?: string }
  | { type: "resource"; resource: PromptResource }
  | { type: "resource_link"; name: string; uri: string; mimeType?: string };
```

**Step 2: Verify build**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/protocol/src/session.ts
git commit -m "feat: add image type to PromptContent union"
```

---

### Task 2: Create image compression utility

**Files:**
- Create: `packages/client/src/lib/image-compress.ts`

**Step 1: Create the compression utility**

Create `packages/client/src/lib/image-compress.ts`:

```typescript
const SUPPORTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_DIMENSION = 2048;
const QUALITY = 0.85;
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export interface CompressedImage {
  data: string; // base64 (no data: prefix)
  mimeType: string;
  name: string;
}

export function isSupportedImageType(type: string): boolean {
  return SUPPORTED_TYPES.has(type);
}

/**
 * Compress an image file: resize if too large, convert to JPEG/WebP for size.
 * Returns base64-encoded data without the data: URI prefix.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  let targetW = width;
  let targetH = height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    targetW = Math.round(width * scale);
    targetH = Math.round(height * scale);
  }

  // GIFs: skip canvas compression (loses animation), just base64 encode
  if (file.type === "image/gif") {
    bitmap.close();
    const buf = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    if (buf.byteLength > MAX_SIZE_BYTES) {
      throw new Error("Image too large (max 20MB)");
    }
    return { data: base64, mimeType: "image/gif", name: file.name };
  }

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  // Try to produce a reasonably-sized output
  const outputType =
    file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await canvas.convertToBlob({
    type: outputType,
    quality: QUALITY,
  });

  if (blob.size > MAX_SIZE_BYTES) {
    throw new Error("Image too large (max 20MB)");
  }

  const buf = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);

  return {
    data: base64,
    mimeType: outputType,
    name: file.name,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
```

**Step 2: Verify build**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/client/src/lib/image-compress.ts
git commit -m "feat: add image compression utility"
```

---

### Task 3: Add pending images state and preview bar to PromptInput

**Files:**
- Modify: `packages/client/src/components/PromptInput.tsx`

**Step 1: Add imports, state, and handler**

At the top of `PromptInput.tsx`, add imports:

```typescript
import { nanoid } from "nanoid";
import { X, Image as ImageIcon } from "lucide-react";
import { compressImage, isSupportedImageType } from "@/lib/image-compress";
```

Add to existing `lucide-react` import: add `X, Image as ImageIcon` alongside existing `ArrowUp, Plus, ChevronDown`.

Inside the component function, after line 48 (`const popupContainerRef`), add:

```typescript
const [pendingImages, setPendingImages] = useState<
  { id: string; data: string; mimeType: string; name: string; previewUrl: string }[]
>([]);
const fileInputRef = useRef<HTMLInputElement>(null);
```

After `fetchFilesRef.current = ...` (line 56), add the shared image handler:

```typescript
const handleImageFiles = useCallback(async (files: FileList | File[]) => {
  const fileArr = Array.from(files);
  for (const file of fileArr) {
    if (!isSupportedImageType(file.type)) continue;
    try {
      const compressed = await compressImage(file);
      const previewUrl = URL.createObjectURL(
        new Blob(
          [Uint8Array.from(atob(compressed.data), (c) => c.charCodeAt(0))],
          { type: compressed.mimeType },
        ),
      );
      setPendingImages((prev) => [
        ...prev,
        { id: nanoid(), ...compressed, previewUrl },
      ]);
    } catch {
      // Silently skip images that fail compression (too large, etc.)
    }
  }
}, []);

const removePendingImage = useCallback((id: string) => {
  setPendingImages((prev) => {
    const img = prev.find((i) => i.id === id);
    if (img) URL.revokeObjectURL(img.previewUrl);
    return prev.filter((i) => i.id !== id);
  });
}, []);
```

**Step 2: Update `canSend` to include pending images**

Change `canSend` (around line 149) from:

```typescript
const canSend =
  !isEmpty &&
  !disabled &&
  !noAgentAvailable &&
  (!!selectedAgentId || agentLocked);
```

to:

```typescript
const canSend =
  (!isEmpty || pendingImages.length > 0) &&
  !disabled &&
  !noAgentAvailable &&
  (!!selectedAgentId || agentLocked);
```

**Step 3: Update `handleSend` to include images**

Replace the `handleSend` callback (lines 60-76) with:

```typescript
const handleSend = useCallback(() => {
  if (!editor) return;

  const hasImages = pendingImages.length > 0;
  const editorEmpty = editor.isEmpty;

  if (editorEmpty && !hasImages) return;

  // Always use onSendContent when we have images or mentions
  const json = editor.getJSON();
  const hasMentions = JSON.stringify(json).includes('"fileMention"');

  if (onSendContent && (hasMentions || hasImages)) {
    const content = serializeTiptapDoc(json, sessionCwd);
    // Append pending images
    for (const img of pendingImages) {
      content.push({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
        name: img.name,
      });
    }
    onSendContent(content);
  } else {
    const text = editor.getText().trim();
    if (text) onSend(text);
  }

  editor.commands.clearContent();
  // Clean up image previews
  for (const img of pendingImages) {
    URL.revokeObjectURL(img.previewUrl);
  }
  setPendingImages([]);
  setIsEmpty(true);
}, [onSend, onSendContent, sessionCwd, pendingImages]);
```

**Step 4: Add hidden file input and wire Attach button**

Replace the Attach button (lines 256-262) with:

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/png,image/jpeg,image/gif,image/webp"
  multiple
  className="hidden"
  onChange={(e) => {
    if (e.target.files) handleImageFiles(e.target.files);
    e.target.value = "";
  }}
  data-testid="image-file-input"
/>
<button
  type="button"
  className="flex size-8 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
  aria-label="Attach"
  onClick={() => fileInputRef.current?.click()}
  data-testid="image-attach-btn"
>
  <Plus className="size-4.5" />
</button>
```

**Step 5: Add preview bar above the input**

Inside the outer card `<div>`, right before `<div className={cn(isDisabled && ...)}>` (line 225), add:

```tsx
{pendingImages.length > 0 && (
  <div
    className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1"
    data-testid="image-preview-bar"
  >
    {pendingImages.map((img) => (
      <div key={img.id} className="group relative shrink-0" data-testid={`image-preview-${img.id}`}>
        <img
          src={img.previewUrl}
          alt={img.name}
          className="h-16 w-16 rounded-lg object-cover border border-border/40"
        />
        <button
          type="button"
          onClick={() => removePendingImage(img.id)}
          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100"
          data-testid={`image-remove-${img.id}`}
        >
          <X className="size-3" />
        </button>
      </div>
    ))}
  </div>
)}
```

**Step 6: Add drag & drop handlers**

On the outer card `<div>` (the one with `overflow-hidden rounded-[1.25rem]`, around line 219), add drag event handlers:

```tsx
<div
  className={cn(
    "overflow-hidden rounded-[1.25rem] border border-border/60 bg-card shadow-sm transition-shadow",
    "focus-within:border-border focus-within:shadow-md",
  )}
  onDragOver={(e) => {
    e.preventDefault();
    e.stopPropagation();
  }}
  onDrop={(e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      handleImageFiles(e.dataTransfer.files);
    }
  }}
>
```

**Step 7: Verify build**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add packages/client/src/components/PromptInput.tsx
git commit -m "feat: add image attach, drag & drop, and preview bar to PromptInput"
```

---

### Task 4: Add clipboard paste support for images

**Files:**
- Modify: `packages/client/src/components/prompt/usePromptEditor.ts`

**Step 1: Add paste handler in editor extensions**

In `usePromptEditor.ts`, the editor is created with `useEditor()`. We need to add a Tiptap extension that intercepts paste events with image files.

At the top of the file, add import:

```typescript
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
```

Note: Check if `Extension` is already imported. If `@tiptap/core` is already imported for something else, just add `Extension` to that import.

The hook accepts an options object. We need to add an `onImagePaste` callback to the options interface. In `UsePromptEditorOptions` (around line 16), add:

```typescript
onImagePaste?: (files: FileList) => void;
```

Then, in the extensions array inside the `useEditor()` call, add a custom extension:

```typescript
Extension.create({
  name: "imagePaste",
  addProseMirrorPlugins() {
    const handler = onImagePaste;
    return [
      new Plugin({
        key: new PluginKey("imagePaste"),
        props: {
          handlePaste(_view, event) {
            const files = event.clipboardData?.files;
            if (files && files.length > 0) {
              const hasImage = Array.from(files).some((f) =>
                f.type.startsWith("image/"),
              );
              if (hasImage && handler) {
                handler(files);
                return true; // prevent default paste
              }
            }
            return false;
          },
        },
      }),
    ];
  },
}),
```

**Step 2: Pass the callback from PromptInput**

In `PromptInput.tsx`, update the `usePromptEditor` call (around line 78):

```typescript
const { editor, popup } = usePromptEditor({
  placeholder,
  editable: !isDisabled,
  fetchFilesRef,
  commands: availableCommands,
  onEnter: handleSend,
  onUpdate: () => {
    if (editor) {
      setIsEmpty(editor.isEmpty);
    }
  },
  onImagePaste: (files) => handleImageFiles(files),
});
```

**Step 3: Verify build**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/client/src/components/prompt/usePromptEditor.ts packages/client/src/components/PromptInput.tsx
git commit -m "feat: add clipboard image paste support via Tiptap extension"
```

---

### Task 5: Update SessionView to display images in messages

**Files:**
- Modify: `packages/client/src/components/chat/SessionView.tsx`

**Step 1: Update `handleSendContent` display text**

In `SessionView.tsx`, the `handleSendContent` callback (line 332) builds display text. Update the `displayText` builder (line 341-343) to handle images:

Change:

```typescript
const displayText = content
  .map((b) => (b.type === "text" ? b.text : b.type === "resource_link" ? `@${b.name}` : ""))
  .join("");
```

to:

```typescript
const imageCount = content.filter((b) => b.type === "image").length;
const displayText = content
  .map((b) =>
    b.type === "text" ? b.text
    : b.type === "resource_link" ? `@${b.name}`
    : "",
  )
  .join("")
  + (imageCount > 0 ? ` [${imageCount} image${imageCount > 1 ? "s" : ""}]` : "");
```

**Step 2: Verify build**

Run: `cd packages/client && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/client/src/components/chat/SessionView.tsx
git commit -m "feat: display image count in user message bubbles"
```

---

### Task 6: Map image PromptContent to ACP ImageContent in the bridge

**Files:**
- Modify: `packages/server/src/acp-bridge/index.ts:129-146`
- Modify: `packages/server/src/index.ts:188-199`

**Step 1: Update ACP bridge sendPrompt to map image blocks**

In `packages/server/src/acp-bridge/index.ts`, in the `sendPrompt` method (line 129), the prompt is sent directly. We need to map `image` blocks to ACP `ImageContent` format.

Change lines 129-146:

```typescript
async sendPrompt(sessionId: SessionId, prompt: PromptContent[]): Promise<unknown> {
  const agentSid = this.agentSessionId || sessionId;
  const id = this.nextId++;
  const message: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: { sessionId: agentSid, prompt },
  };

  this.promptRequests.set(id, { sessionId, agentSessionId: agentSid, sawCompleted: false });
  this.write(message);

  return new Promise((resolve, reject) => {
    this.pendingRequests.set(id, { resolve, reject, timer: null });
  });
}
```

to:

```typescript
async sendPrompt(sessionId: SessionId, prompt: PromptContent[]): Promise<unknown> {
  const agentSid = this.agentSessionId || sessionId;
  const id = this.nextId++;

  // Map Matrix PromptContent to ACP-native content blocks.
  // Image blocks become ACP ImageContent; others pass through as-is.
  const acpPrompt = prompt.map((block) => {
    if (block.type === "image") {
      return { type: "image", data: block.data, mimeType: block.mimeType };
    }
    return block;
  });

  const message: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: { sessionId: agentSid, prompt: acpPrompt },
  };

  this.promptRequests.set(id, { sessionId, agentSessionId: agentSid, sawCompleted: false });
  this.write(message);

  return new Promise((resolve, reject) => {
    this.pendingRequests.set(id, { resolve, reject, timer: null });
  });
}
```

**Step 2: Update server history text builder to handle images**

In `packages/server/src/index.ts`, the `handlePrompt` function (around line 188-199) builds history text. Update the loop:

Change:

```typescript
const textParts: string[] = [];
for (const item of prompt) {
  if (item.type === "text") {
    textParts.push(item.text);
  } else if (item.type === "resource_link") {
    textParts.push(`@${item.name}`);
  }
}
```

to:

```typescript
const textParts: string[] = [];
let imageCount = 0;
for (const item of prompt) {
  if (item.type === "text") {
    textParts.push(item.text);
  } else if (item.type === "resource_link") {
    textParts.push(`@${item.name}`);
  } else if (item.type === "image") {
    imageCount++;
  }
}
if (imageCount > 0) {
  textParts.push(` [${imageCount} image${imageCount > 1 ? "s" : ""}]`);
}
```

**Step 3: Verify build**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/server/src/acp-bridge/index.ts packages/server/src/index.ts
git commit -m "feat: map image PromptContent to ACP ImageContent in bridge"
```

---

### Task 7: Verify full build and manual test

**Step 1: Run full build**

```bash
npm run build
```

Expected: No errors across all packages

**Step 2: Run existing tests**

```bash
npm test
```

Expected: All existing tests pass (no regressions)

**Step 3: Final commit if any fixes needed**

If any type errors or test failures require fixes, address them and commit.
