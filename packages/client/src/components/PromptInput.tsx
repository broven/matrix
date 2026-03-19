import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  isProcessing?: boolean;
  agentName?: string;
}

export function PromptInput({
  onSend,
  disabled,
  placeholder = "Ask to make changes, @mention files, run /commands",
  isProcessing,
  agentName,
}: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [text]);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-4 pb-4 pt-2 md:px-6">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            "overflow-hidden rounded-[1.25rem] border border-border/60 bg-card shadow-sm transition-shadow",
            "focus-within:border-border focus-within:shadow-md",
          )}
        >
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="max-h-[200px] min-h-[52px] resize-none border-0 bg-transparent px-4 py-3.5 text-[0.9375rem] leading-relaxed placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="flex items-center justify-between px-3 pb-2.5 pt-0">
            <div className="flex items-center gap-2">
              {agentName && (
                <span className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                  <span className="size-1.5 rounded-full bg-primary" />
                  {agentName}
                </span>
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
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
