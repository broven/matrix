# Image Send Design

## Overview

Enable sending images to ACP agents (Claude Code, etc.) from the Matrix chat input. Images are transmitted as base64-encoded data via ACP's `ImageContent` block type.

## Decisions

- **Input methods**: Attach button, clipboard paste (Cmd+V), drag & drop — all supported
- **Display**: Thumbnail preview in chat message bubbles
- **Size/format**: Auto-compress first, warn if still too large
- **Multi-image**: Unlimited per message, preview bar above input
- **Storage**: No persistence — in-memory only, placeholder in history

## Part 1: Protocol & Data Flow

### PromptContent Extension

In `packages/protocol/src/session.ts`, add `image` type:

```typescript
export type PromptContent =
  | { type: "text"; text: string; agentId?: string; profileId?: string }
  | { type: "image"; data: string; mimeType: string; name?: string }
  | { type: "resource"; resource: PromptResource }
  | { type: "resource_link"; name: string; uri: string; mimeType?: string };
```

### End-to-End Data Flow

```
Client: File/Paste/Drop → compress → base64
  ↓
SDK: promptWithContent([...text, ...images])  // type: "image"
  ↓
Server/WS: passthrough PromptContent[]
  ↓
ACP Bridge sendPrompt(): map image → ACP ImageContent
  { type: "image", data: "<base64>", mimeType: "image/png" }
  ↓
Agent (Claude Code): receives and processes image
```

### No Persistence

- Image base64 only exists in the WebSocket message stream, not written to SQLite
- History records store `{ type: "image", expired: true }` as placeholder
- Reopening history sessions shows `[Image expired]` placeholder

## Part 2: Client Image Input

### Three Input Methods → Shared Handler

```
Attach button ──→ <input type="file" accept="image/*" multiple>
Paste Cmd+V ───→ clipboardData.files
Drag & drop ───→ dragEvent.dataTransfer.files
        ↓
   handleImageFiles(files: File[])
        ↓
   validate format → compress → generate preview → add to pendingImages
```

### Compression Strategy

- Supported formats: PNG/JPEG/GIF/WebP
- Auto-scale large images to max longest edge 2048px
- JPEG/WebP compression quality 0.85
- If still > 20MB after compression → toast warning

### State Management

In `PromptInput` component:

```typescript
const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

interface PendingImage {
  id: string;        // nanoid
  file: File;        // original file (post-compression)
  data: string;      // base64
  mimeType: string;
  previewUrl: string; // URL.createObjectURL for preview
}
```

### Preview Bar UI

Horizontal thumbnail strip above input box, each with × remove button. Sent together with text as `PromptContent[]`.

## Part 3: Serialization & Sending

### serializeTiptap Extension

`packages/client/src/components/prompt/serializeTiptap.ts`:

```typescript
function serializeTiptap(
  doc: TiptapDoc,
  pendingImages: PendingImage[]
): PromptContent[] {
  const content: PromptContent[] = [];

  // 1. Serialize text and file mentions (existing logic unchanged)
  // ...

  // 2. Append images
  for (const img of pendingImages) {
    content.push({
      type: "image",
      data: img.data,
      mimeType: img.mimeType,
      name: img.file.name,
    });
  }

  return content;
}
```

### ACP Bridge Mapping

`packages/server/src/acp-bridge/index.ts` in `sendPrompt`:

```typescript
const acpPrompt = prompt.map(block => {
  if (block.type === "image") {
    return { type: "image", data: block.data, mimeType: block.mimeType };
  }
  return block;
});
```

### Chat History Rendering

- `type: "image"` with `data` → render `<img src="data:${mimeType};base64,${data}" />` thumbnail, click to enlarge
- `type: "image"` with `expired: true` → render `[Image expired]` gray placeholder

## Part 4: Capability Detection & Edge Cases

### Agent Image Capability Check

```typescript
const agent = getActiveAgent();
if (pendingImages.length > 0 && !agent.promptCapabilities?.image) {
  toast.warning(`${agent.name} does not support image input`);
  return;
}
```

### Error Handling

| Scenario | Handling |
|----------|----------|
| Non-image file dragged/pasted | Ignore silently |
| Unsupported format (SVG/BMP) | Toast with supported formats |
| Still > 20MB after compression | Toast "Image too large" |
| Agent doesn't support images | Toast warning, block send |
| Base64 encoding failure | Toast error, remove that image |

### data-testid Plan

- `image-attach-btn` — Attach button
- `image-preview-bar` — Preview bar container
- `image-preview-{id}` — Single preview thumbnail
- `image-remove-{id}` — Remove button per image
- `image-expired-placeholder` — Expired placeholder

## Files to Modify

1. `packages/protocol/src/session.ts` — Add `image` to PromptContent union
2. `packages/client/src/components/prompt/PromptInput.tsx` — Wire attach button, paste, drag & drop, preview bar
3. `packages/client/src/components/prompt/serializeTiptap.ts` — Serialize pending images
4. `packages/client/src/components/prompt/usePromptEditor.ts` — Paste handler
5. `packages/server/src/acp-bridge/index.ts` — Map image PromptContent to ACP ImageContent
6. `packages/client/src/components/chat/SessionView.tsx` — Render image blocks in messages
7. New: `packages/client/src/lib/image-compress.ts` — Compression utility
