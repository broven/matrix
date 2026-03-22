import { forwardRef, useImperativeHandle } from "react";
import type { AvailableCommand } from "@matrix/protocol";
import { cn } from "@/lib/utils";

interface SlashCommandListProps {
  items: AvailableCommand[];
  command: (item: AvailableCommand) => void;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  ({ items, command, selectedIndex, setSelectedIndex }, ref) => {
    useImperativeHandle(ref, () => ({
      onKeyDown({ event }: { event: KeyboardEvent }) {
        if (event.key === "ArrowDown") {
          setSelectedIndex((selectedIndex + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex((selectedIndex - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        if (event.key === "Escape") {
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return (
      <div
        data-testid="slash-command-dropdown"
        className="max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
      >
        {items.map((cmd, index) => (
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
              e.preventDefault();
              command(cmd);
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
    );
  },
);

SlashCommandList.displayName = "SlashCommandList";
