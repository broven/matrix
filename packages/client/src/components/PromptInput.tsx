import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AvailableCommand, PromptContent } from "@matrix/protocol";
import type { AgentListItem } from "@matrix/protocol";
import { ArrowUp, Plus, ChevronDown, File } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useFileMention, type FileMention } from "@/hooks/useFileMention";

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

function useSlashAutocomplete(
  text: string,
  commands: AvailableCommand[],
  cursorPos: number,
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Find the slash query: look backwards from cursor for "/"
  const textBeforeCursor = text.slice(0, cursorPos);
  const slashIndex = textBeforeCursor.lastIndexOf("/");

  let query = "";
  let isActive = false;

  if (slashIndex !== -1 && commands.length > 0) {
    // Only activate if "/" is at start or preceded by whitespace
    if (slashIndex === 0 || /\s/.test(textBeforeCursor[slashIndex - 1])) {
      const afterSlash = textBeforeCursor.slice(slashIndex + 1);
      // Only activate if there's no space in the query (user is still typing the command name)
      if (!/\s/.test(afterSlash)) {
        query = afterSlash.toLowerCase();
        isActive = true;
      }
    }
  }

  const filtered = isActive
    ? commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(query) ||
          cmd.description?.toLowerCase().includes(query),
      )
    : [];

  const isOpen = filtered.length > 0;

  // Reset selection when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [isOpen, filtered.length]);

  return {
    isOpen,
    filtered,
    selectedIndex,
    setSelectedIndex,
    slashIndex,
  };
}

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
  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [mentions, setMentions] = useState<FileMention[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileDropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const agentBtnRef = useRef<HTMLButtonElement>(null);

  const { isOpen, filtered, selectedIndex, setSelectedIndex, slashIndex } =
    useSlashAutocomplete(text, availableCommands, cursorPos);

  const noopFetch = useCallback(() => Promise.resolve([]) as Promise<string[]>, []);
  const fileMention = useFileMention({
    fetchFiles: fetchFiles ?? noopFetch,
    text,
    cursorPos,
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [text]);

  // Scroll selected slash command item into view
  useEffect(() => {
    if (!isOpen || !dropdownRef.current) return;
    const item = dropdownRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [isOpen, selectedIndex]);

  // Scroll selected file mention item into view
  useEffect(() => {
    if (!fileMention.isOpen || !fileDropdownRef.current) return;
    const item = fileDropdownRef.current.children[fileMention.selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [fileMention.isOpen, fileMention.selectedIndex]);

  const selectCommand = useCallback(
    (cmd: AvailableCommand) => {
      const before = text.slice(0, slashIndex);
      const after = text.slice(cursorPos);
      const newText = `${before}/${cmd.name} ${after}`;
      setText(newText);
      setCursorPos(before.length + cmd.name.length + 2); // after "/<name> "
    },
    [text, slashIndex, cursorPos],
  );

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

  // Close menu on outside click
  useEffect(() => {
    if (!agentMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        agentBtnRef.current && !agentBtnRef.current.contains(target)
      ) {
        setAgentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [agentMenuOpen]);

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

    // Slash command popover navigation
    if (isOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        selectCommand(filtered[selectedIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Remove the "/" and query text to dismiss dropdown
        const before = text.slice(0, slashIndex);
        const after = text.slice(cursorPos);
        setText(before + after);
        setCursorPos(slashIndex);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const availableAgents = agents.filter((a) => a.available);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const selectedProfile = (selectedAgent?.profiles ?? []).find((p) => p.id === selectedProfileId);

  return (
    <div className="px-4 pb-4 pt-2 md:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          {/* Popover menus rendered outside overflow-hidden card container */}
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
          {isOpen && (
            <div
              ref={dropdownRef}
              data-testid="slash-command-dropdown"
              className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
            >
              {filtered.map((cmd, index) => (
                <button
                  key={cmd.name}
                  type="button"
                  data-testid={`slash-command-item-${cmd.name}`}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Keep textarea focused
                    selectCommand(cmd);
                  }}
                >
                  <span className="text-sm font-medium">/{cmd.name}</span>
                  {cmd.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {cmd.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {agentMenuOpen && !agentLocked && availableAgents.length > 0 && (
            <div ref={menuRef} className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
              {availableAgents.map((agent) => {
                const profiles = agent.profiles ?? [];
                const isSelected = agent.id === selectedAgentId;
                return (
                  <div key={agent.id}>
                    {/* Agent row — selects agent with default (no profile) */}
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
                    {/* Profile sub-items */}
                    {profiles.length > 0 && profiles.map((profile) => (
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
          >
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setCursorPos(event.target.selectionStart);
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled || noAgentAvailable}
              rows={1}
              className="max-h-[200px] min-h-[52px] resize-none border-0 bg-transparent px-4 py-3.5 text-[0.9375rem] leading-relaxed placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0"
              data-testid="chat-input"
            />
            <div className="flex items-center justify-between px-3 pb-2.5 pt-0">
              <div className="flex items-center gap-2">
                <button
                  ref={agentBtnRef}
                  type="button"
                  onClick={() => !agentLocked && setAgentMenuOpen(!agentMenuOpen)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors",
                    agentLocked ? "opacity-60 cursor-default" : "hover:bg-secondary/80",
                  )}
                  disabled={agentLocked}
                  data-testid="agent-selector-btn"
                >
                  <span className="size-1.5 rounded-full bg-primary" />
                  {selectedAgent?.name ?? "Select agent"}
                  {selectedProfile && (
                    <span className="text-muted-foreground">/ {selectedProfile.name}</span>
                  )}
                  {!agentLocked && <ChevronDown className="size-3 text-muted-foreground" />}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Attach"
                >
                  <Plus className="size-4.5" />
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={disabled || !text.trim() || noAgentAvailable || (!selectedAgentId && !agentLocked)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-all",
                    text.trim() && !disabled && !noAgentAvailable && (!!selectedAgentId || agentLocked)
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
