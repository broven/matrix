import { useCallback, useRef, useState } from "react";
import { useEditor, ReactRenderer, Extension } from "@tiptap/react";
import type { Editor, Range } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import type { AvailableCommand } from "@matrix/protocol";
import { FileMentionExtension, FileMentionPluginKey } from "./FileMentionExtension";
import { FileMentionList, type FileMentionListRef } from "./FileMentionList";
import { SlashCommandExtension, SlashCommandPluginKey } from "./SlashCommandExtension";
import { SlashCommandList, type SlashCommandListRef } from "./SlashCommandList";

interface UsePromptEditorOptions {
  placeholder: string;
  editable: boolean;
  fetchFilesRef: React.RefObject<((query: string) => Promise<string[]>) | null>;
  commands: AvailableCommand[];
  onEnter: () => void;
  onUpdate?: () => void;
  onImagePaste?: (files: FileList) => void;
}

interface PopupState {
  type: "file" | "slash" | null;
  component: ReactRenderer<any> | null;
}

export function usePromptEditor({
  placeholder,
  editable,
  fetchFilesRef,
  commands,
  onEnter,
  onUpdate,
  onImagePaste,
}: UsePromptEditorOptions) {
  const [popup, setPopup] = useState<PopupState>({ type: null, component: null });
  const popupRef = useRef<PopupState>({ type: null, component: null });
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;

  const [fileSelectedIndex, setFileSelectedIndex] = useState(0);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const destroyPopup = useCallback(() => {
    if (popupRef.current.component) {
      popupRef.current.component.destroy();
    }
    popupRef.current = { type: null, component: null };
    setPopup({ type: null, component: null });
  }, []);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      History,
      Placeholder.configure({ placeholder }),
      FileMentionExtension.configure({
        suggestion: {
          char: "@",
          pluginKey: FileMentionPluginKey,
          allowSpaces: false,
          allowedPrefixes: null,
          items: async ({ query }: { query: string }): Promise<string[]> => {
            const fn = fetchFilesRef.current;
            if (!fn) return [];
            try {
              return await fn(query);
            } catch {
              return [];
            }
          },
          render: () => {
            let component: ReactRenderer<FileMentionListRef> | null = null;
            let selectedIdx = 0;

            return {
              onStart(props: SuggestionProps<string>) {
                selectedIdx = 0;
                component = new ReactRenderer(FileMentionList, {
                  props: {
                    ...props,
                    selectedIndex: selectedIdx,
                    setSelectedIndex: (idx: number) => {
                      selectedIdx = idx;
                      component?.updateProps({ selectedIndex: idx });
                      setFileSelectedIndex(idx);
                    },
                  },
                  editor: props.editor,
                });
                popupRef.current = { type: "file", component };
                setPopup({ type: "file", component });
                setFileSelectedIndex(0);
              },
              onUpdate(props: SuggestionProps<string>) {
                selectedIdx = 0;
                component?.updateProps({
                  ...props,
                  selectedIndex: selectedIdx,
                  setSelectedIndex: (idx: number) => {
                    selectedIdx = idx;
                    component?.updateProps({ selectedIndex: idx });
                    setFileSelectedIndex(idx);
                  },
                });
                setFileSelectedIndex(0);
              },
              onKeyDown(props: SuggestionKeyDownProps) {
                if (props.event.key === "Escape") {
                  destroyPopup();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit() {
                destroyPopup();
              },
            };
          },
        },
      }),
      SlashCommandExtension.configure({
        suggestion: {
          char: "/",
          pluginKey: SlashCommandPluginKey,
          allowedPrefixes: null,
          startOfLine: false,
          items: ({ query }: { query: string }): AvailableCommand[] => {
            const cmds = commandsRef.current;
            if (!cmds.length) return [];
            const q = query.toLowerCase();
            return cmds.filter(
              (cmd) =>
                cmd.name.toLowerCase().includes(q) ||
                cmd.description?.toLowerCase().includes(q),
            );
          },
          command: ({ editor: ed, range, props }: { editor: Editor; range: Range; props: any }) => {
            const cmd = props as AvailableCommand;
            ed.chain().focus().deleteRange(range).insertContent(`/${cmd.name} `).run();
          },
          render: () => {
            let component: ReactRenderer<SlashCommandListRef> | null = null;
            let selectedIdx = 0;

            return {
              onStart(props: SuggestionProps<AvailableCommand>) {
                selectedIdx = 0;
                component = new ReactRenderer(SlashCommandList, {
                  props: {
                    ...props,
                    selectedIndex: selectedIdx,
                    setSelectedIndex: (idx: number) => {
                      selectedIdx = idx;
                      component?.updateProps({ selectedIndex: idx });
                      setSlashSelectedIndex(idx);
                    },
                  },
                  editor: props.editor,
                });
                popupRef.current = { type: "slash", component };
                setPopup({ type: "slash", component });
                setSlashSelectedIndex(0);
              },
              onUpdate(props: SuggestionProps<AvailableCommand>) {
                selectedIdx = 0;
                component?.updateProps({
                  ...props,
                  selectedIndex: selectedIdx,
                  setSelectedIndex: (idx: number) => {
                    selectedIdx = idx;
                    component?.updateProps({ selectedIndex: idx });
                    setSlashSelectedIndex(idx);
                  },
                });
                setSlashSelectedIndex(0);
              },
              onKeyDown(props: SuggestionKeyDownProps) {
                if (props.event.key === "Escape") {
                  destroyPopup();
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },
              onExit() {
                destroyPopup();
              },
            };
          },
        },
      }),
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
    ],
    editable,
    editorProps: {
      attributes: {
        "data-testid": "chat-input",
        role: "textbox",
        "aria-multiline": "true",
        class:
          "tiptap max-h-[200px] min-h-[52px] w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-3.5 text-[0.9375rem] leading-relaxed outline-none",
      },
      handleKeyDown(_view, event) {
        // Don't intercept Enter when a suggestion popup is open
        if (popupRef.current.type !== null) return false;

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onEnterRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate() {
      onUpdate?.();
    },
  });

  return {
    editor,
    popup,
    fileSelectedIndex,
    slashSelectedIndex,
  };
}
