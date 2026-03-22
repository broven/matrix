import type { PromptContent } from "@matrix/protocol";
import type { JSONContent } from "@tiptap/react";

/**
 * Walk a Tiptap JSON document and produce a flat PromptContent[] array.
 * - Text nodes become { type: "text", text }
 * - fileMention nodes become { type: "resource_link", name, uri }
 * - Paragraph boundaries become "\n"
 */
export function serializeTiptapDoc(
  doc: JSONContent,
  cwd?: string,
): PromptContent[] {
  const blocks: PromptContent[] = [];
  const paragraphs = doc.content ?? [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi];

    // Insert newline between paragraphs
    if (pi > 0) {
      blocks.push({ type: "text", text: "\n" });
    }

    if (!para.content) continue;

    for (const node of para.content) {
      if (node.type === "text" && node.text) {
        blocks.push({ type: "text", text: node.text });
      } else if (node.type === "fileMention") {
        const path: string = node.attrs?.path ?? node.attrs?.id ?? "";
        const name: string =
          node.attrs?.label ?? path.split("/").pop() ?? path;
        const uri = cwd ? `file://${cwd}/${path}` : `file:///${path}`;
        blocks.push({ type: "resource_link", name, uri });
      }
    }
  }

  // Merge adjacent text blocks
  const merged: PromptContent[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (block.type === "text" && last?.type === "text") {
      (last as { type: "text"; text: string }).text += block.text;
    } else {
      merged.push(block);
    }
  }

  if (merged.length === 0) {
    merged.push({ type: "text", text: "" });
  }

  return merged;
}
