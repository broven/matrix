import { forwardRef, useImperativeHandle } from "react";
import { File } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileMentionListProps {
  items: string[];
  command: (item: { id: string; label: string; path: string }) => void;
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
}

export interface FileMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const FileMentionList = forwardRef<FileMentionListRef, FileMentionListProps>(
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
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[selectedIndex];
          if (item) {
            const name = item.split("/").pop() ?? item;
            command({ id: item, label: name, path: item });
          }
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
        data-testid="file-mention-dropdown"
        className="max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
      >
        {items.map((filePath, index) => {
          const name = filePath.split("/").pop() ?? filePath;
          const dir = filePath.includes("/")
            ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
            : "";
          return (
            <button
              key={filePath}
              type="button"
              data-testid={`file-mention-item-${name}`}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                index === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50",
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                command({ id: filePath, label: name, path: filePath });
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
    );
  },
);

FileMentionList.displayName = "FileMentionList";
