import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import type { AvailableCommand, PromptContent } from "@matrix/protocol";
import type { AgentListItem } from "@matrix/protocol";
import { nanoid } from "nanoid";
import { ArrowUp, Plus, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { compressImage, isSupportedImageType } from "@/lib/image-compress";
import { usePromptEditor } from "./prompt/usePromptEditor";
import { serializeTiptapDoc } from "./prompt/serializeTiptap";

interface Props {
  onSend: (text: string) => void;
  onSendContent?: (content: PromptContent[]) => void;
  disabled?: boolean;
  placeholder?: string;
  isProcessing?: boolean;
  agents?: AgentListItem[];
  selectedAgentId: string | null;
  selectedProfileId: string | null;
  onAgentChange?: (agentId: string) => void;
  onProfileChange?: (profileId: string | null) => void;
  availableCommands?: AvailableCommand[];
  /** When true, agent/profile selectors are locked (session already bound to an agent) */
  agentLocked?: boolean;
  noAgentAvailable?: boolean;
  fetchFiles?: (query: string) => Promise<string[]>;
  sessionCwd?: string;
}

export function PromptInput({
  onSend,
  onSendContent,
  disabled,
  placeholder = "Ask to make changes, @mention files, run /commands",
  isProcessing,
  agents = [],
  selectedAgentId,
  selectedProfileId,
  onAgentChange,
  onProfileChange,
  availableCommands = [],
  agentLocked = false,
  noAgentAvailable = false,
  fetchFiles,
  sessionCwd,
}: Props) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentBtnRef = useRef<HTMLButtonElement>(null);
  const popupContainerRef = useRef<HTMLDivElement>(null);
  const [pendingImages, setPendingImages] = useState<
    { id: string; data: string; mimeType: string; name: string; previewUrl: string }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store fetchFiles in a ref so the suggestion plugin always reads the latest
  const fetchFilesRef = useRef<((query: string) => Promise<string[]>) | null>(
    fetchFiles ?? null,
  );
  fetchFilesRef.current = fetchFiles ?? null;

  const [imageError, setImageError] = useState<string | null>(null);

  const handleImageFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      if (!file.type.startsWith("image/")) continue;
      if (!isSupportedImageType(file.type)) {
        setImageError(`Unsupported format: ${file.type}. Use PNG, JPEG, GIF, or WebP.`);
        continue;
      }
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
      } catch (err) {
        setImageError(err instanceof Error ? err.message : "Failed to process image");
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

  const isDisabled = disabled || noAgentAvailable;

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

  // Update handleSend's closure on editor
  // (handleSend references editor which may be null initially)
  useEffect(() => {
    if (editor) {
      setIsEmpty(editor.isEmpty);
    }
  }, [editor]);

  // Auto-resize editor element
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom as HTMLElement;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  });

  // Update editable state when disabled changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isDisabled);
    }
  }, [editor, isDisabled]);

  // Close agent menu on outside click
  useEffect(() => {
    if (!agentMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        agentBtnRef.current &&
        !agentBtnRef.current.contains(target)
      ) {
        setAgentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [agentMenuOpen]);

  // Render popup element into our container
  useEffect(() => {
    const container = popupContainerRef.current;
    if (!container) return;
    // Clear previous
    container.innerHTML = "";
    if (popup.component) {
      container.appendChild(popup.component.element);
    }
  }, [popup]);

  const availableAgents = agents.filter((a) => a.available);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const selectedProfile = (selectedAgent?.profiles ?? []).find(
    (p) => p.id === selectedProfileId,
  );

  const canSend =
    (!isEmpty || pendingImages.length > 0) &&
    !disabled &&
    !noAgentAvailable &&
    (!!selectedAgentId || agentLocked);

  return (
    <div className="px-4 pb-4 pt-2 md:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          {/* Popup container for suggestion dropdowns */}
          <div
            ref={popupContainerRef}
            className="absolute bottom-full left-0 right-0 z-50 mb-1"
          />
          {/* Agent menu */}
          {agentMenuOpen && !agentLocked && availableAgents.length > 0 && (
            <div
              ref={menuRef}
              className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
            >
              {availableAgents.map((agent) => {
                const profiles = agent.profiles ?? [];
                const isSelected = agent.id === selectedAgentId;
                return (
                  <div key={agent.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onAgentChange?.(agent.id);
                        onProfileChange?.(null);
                        setAgentMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                        isSelected && !selectedProfileId
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50",
                      )}
                      data-testid={`agent-option-${agent.id}`}
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="truncate">{agent.name}</span>
                    </button>
                    {profiles.length > 0 &&
                      profiles.map((profile) => (
                        <button
                          key={profile.id}
                          type="button"
                          onClick={() => {
                            onAgentChange?.(agent.id);
                            onProfileChange?.(profile.id);
                            setAgentMenuOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md py-1.5 pl-6 pr-2.5 text-left text-sm transition-colors",
                            isSelected && selectedProfileId === profile.id
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/50 text-muted-foreground",
                          )}
                          data-testid={`profile-option-${profile.id}`}
                        >
                          <span className="truncate">{profile.name}</span>
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
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
            {imageError && (
              <div className="flex items-center justify-between gap-2 px-3 pt-2 text-xs text-destructive">
                <span>{imageError}</span>
                <button type="button" onClick={() => setImageError(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </div>
            )}
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
            <div className={cn(isDisabled && "cursor-not-allowed opacity-50")}>
              <EditorContent editor={editor} />
            </div>
            <div className="flex items-center justify-between px-3 pb-2.5 pt-0">
              <div className="flex items-center gap-2">
                <button
                  ref={agentBtnRef}
                  type="button"
                  onClick={() => !agentLocked && setAgentMenuOpen(!agentMenuOpen)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors",
                    agentLocked
                      ? "opacity-60 cursor-default"
                      : "hover:bg-secondary/80",
                  )}
                  disabled={agentLocked}
                  data-testid="agent-selector-btn"
                >
                  <span className="size-1.5 rounded-full bg-primary" />
                  {selectedAgent?.name ?? "Select agent"}
                  {selectedProfile && (
                    <span className="text-muted-foreground">
                      / {selectedProfile.name}
                    </span>
                  )}
                  {!agentLocked && (
                    <ChevronDown className="size-3 text-muted-foreground" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
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
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-all",
                    canSend
                      ? "bg-foreground text-background hover:opacity-80"
                      : "bg-muted text-muted-foreground/40",
                  )}
                  aria-label="Send message"
                  data-testid="send-btn"
                >
                  <ArrowUp className="size-4" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
