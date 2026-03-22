import { Extension } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions } from "@tiptap/suggestion";

export const SlashCommandPluginKey = new PluginKey("slashCommand");

export interface SlashCommandOptions {
  suggestion: Omit<SuggestionOptions, "editor">;
}

export const SlashCommandExtension = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        pluginKey: SlashCommandPluginKey,
        allowedPrefixes: null,
        startOfLine: false,
        command: ({ editor, range, props }: { editor: any; range: any; props: any }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(`/${(props as { name: string }).name} `)
            .run();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
