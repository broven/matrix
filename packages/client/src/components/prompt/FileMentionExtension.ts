import { Mention } from "@tiptap/extension-mention";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import { FileMentionPill } from "./FileMentionPill";

export const FileMentionPluginKey = new PluginKey("fileMention");

export const FileMentionExtension = Mention.extend({
  name: "fileMention",
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
      path: { default: null },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileMentionPill, {
      // Render inline, no wrapper block
      as: "span",
      className: "",
    });
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      {
        "data-type": this.name,
        "data-id": node.attrs.id,
        "data-label": node.attrs.label,
        "data-path": node.attrs.path,
        ...HTMLAttributes,
      },
      node.attrs.label ?? node.attrs.id ?? "",
    ];
  },
});
