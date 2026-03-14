import { useState, type KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function PromptInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="prompt-bar" style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #e5e7eb" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter message..."
        disabled={disabled}
        rows={3}
        style={{ flex: 1, padding: 8, resize: "vertical", fontFamily: "inherit" }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        style={{ padding: "8px 20px", cursor: "pointer", alignSelf: "end" }}
      >
        Send
      </button>
    </div>
  );
}
