import { useEffect, useRef, useState, useCallback, type KeyboardEvent } from "react";
import type { AgentListItem, AvailableCommand } from "@matrix/protocol";
import { ArrowUp, Plus, ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  isProcessing?: boolean;
  agents?: AgentListItem[];
  selectedAgentId: string | null;
  onAgentChange?: (agentId: string) => void;
  availableCommands?: AvailableCommand[];
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

export function PromptInput({
  onSend,
  disabled,
  placeholder = "Ask to make changes, @mention files, run /commands",
  isProcessing,
  agents = [],
  selectedAgentId,
  onAgentChange,
  availableCommands = [],
}: Props) {
  const [text, setText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { isOpen, filtered, selectedIndex, setSelectedIndex, slashIndex } =
    useSlashAutocomplete(text, availableCommands, cursorPos);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [text]);

  // Scroll selected item into view
  useEffect(() => {
    if (!isOpen || !dropdownRef.current) return;
    const item = dropdownRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [isOpen, selectedIndex]);

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

  // Close menu on outside click
  useEffect(() => {
    if (!agentMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAgentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [agentMenuOpen]);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className="px-4 pb-4 pt-2 md:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="relative">
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
              disabled={disabled}
              rows={1}
              className="max-h-[200px] min-h-[52px] resize-none border-0 bg-transparent px-4 py-3.5 text-[0.9375rem] leading-relaxed placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0"
              data-testid="chat-input"
            />
            <div className="flex items-center justify-between px-3 pb-2.5 pt-0">
              <div className="relative flex items-center gap-2" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setAgentMenuOpen(!agentMenuOpen)}
                  className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  <span className="size-1.5 rounded-full bg-primary" />
                  {selectedAgent?.name ?? "Select agent"}
                  <ChevronDown className="size-3 text-muted-foreground" />
                </button>
                {agentMenuOpen && availableAgents.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-1 min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-md">
                    {availableAgents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          onAgentChange?.(agent.id);
                          setAgentMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                          agent.id === selectedAgentId
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50",
                        )}
                      >
                        <span className="size-1.5 rounded-full bg-primary" />
                        <span className="truncate">{agent.name}</span>
                      </button>
                    ))}
                  </div>
                )}
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
                  disabled={disabled || !text.trim()}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-all",
                    text.trim() && !disabled
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
