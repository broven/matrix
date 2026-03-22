import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { File } from "lucide-react";

export function FileMentionPill({ node }: NodeViewProps) {
  const path: string = node.attrs.path ?? node.attrs.id ?? "";
  const label: string = node.attrs.label ?? path.split("/").pop() ?? path;

  return (
    <NodeViewWrapper
      as="span"
      className="inline-flex items-center gap-0.5 rounded bg-accent mx-0.5 px-1.5 py-px text-[inherit] font-medium"
      data-testid={`file-mention-pill-${label}`}
      title={path}
      contentEditable={false}
    >
      <File className="size-3 shrink-0" strokeWidth={2} />
      {label}
    </NodeViewWrapper>
  );
}
