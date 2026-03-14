import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function PromptInput({ onSend, disabled, placeholder = "Message the active session..." }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
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
    <div className="border-t border-border bg-background/95 px-4 py-4 backdrop-blur md:px-6">
      <div className="mx-auto flex max-w-5xl items-end gap-3">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="max-h-60 min-h-12 resize-none rounded-2xl border-border/80 bg-card px-4 py-3 shadow-sm"
        />
        <Button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          size="icon-lg"
          className="rounded-2xl"
        >
          <ArrowUp className="size-5" />
          <span className="sr-only">Send prompt</span>
        </Button>
      </div>
    </div>
  );
}
