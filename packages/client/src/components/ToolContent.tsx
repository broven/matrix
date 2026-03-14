import { useState } from "react";
import type { ToolCallContent } from "@matrix/protocol";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function computeDiffLines(path: string, oldText: string, newText: string) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: Array<{ text: string; type: "added" | "removed" | "context" | "header" }> = [
    { text: `--- ${path}`, type: "header" },
    { text: `+++ ${path}`, type: "header" },
  ];

  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push({ text: ` ${oldLines[i]}`, type: "context" });
      i += 1;
      j += 1;
      continue;
    }

    let synced = false;
    for (let lookAhead = 1; lookAhead <= 5 && !synced; lookAhead += 1) {
      if (j + lookAhead < newLines.length && i < oldLines.length && oldLines[i] === newLines[j + lookAhead]) {
        for (let offset = 0; offset < lookAhead; offset += 1) {
          lines.push({ text: `+${newLines[j + offset]}`, type: "added" });
        }
        j += lookAhead;
        synced = true;
      } else if (i + lookAhead < oldLines.length && j < newLines.length && oldLines[i + lookAhead] === newLines[j]) {
        for (let offset = 0; offset < lookAhead; offset += 1) {
          lines.push({ text: `-${oldLines[i + offset]}`, type: "removed" });
        }
        i += lookAhead;
        synced = true;
      }
    }

    if (!synced) {
      if (i < oldLines.length) {
        lines.push({ text: `-${oldLines[i]}`, type: "removed" });
        i += 1;
      }
      if (j < newLines.length) {
        lines.push({ text: `+${newLines[j]}`, type: "added" });
        j += 1;
      }
    }
  }

  return lines;
}

function DiffViewer({ path, oldText, newText }: { path: string; oldText: string; newText: string }) {
  const [expanded, setExpanded] = useState(false);
  const diffLines = expanded ? computeDiffLines(path, oldText, newText) : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <code className="text-xs text-muted-foreground">{path}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-full px-2.5 text-xs"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          View Changes
        </Button>
      </div>
      {expanded ? (
        <div className="diff-viewer bg-card/80">
          {diffLines.map((line, index) => {
            const className =
              line.type === "added"
                ? "diff-line diff-line--added"
                : line.type === "removed"
                  ? "diff-line diff-line--removed"
                  : line.type === "header"
                    ? "diff-line diff-line--header"
                    : "diff-line";

            return (
              <div key={`${line.text}-${index}`} className={className}>
                {line.text}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function TextContent({ text }: { text: string }) {
  return (
    <pre className="overflow-auto rounded-xl border bg-card/80 p-3 text-xs leading-6 whitespace-pre-wrap text-foreground">
      {text}
    </pre>
  );
}

export function ToolContentList({ content }: { content?: ToolCallContent[] }) {
  if (!content?.length) return null;

  return (
    <div className="space-y-3">
      {content.map((item, index) =>
        item.type === "diff" ? (
          <DiffViewer
            key={`${item.path}-${index}`}
            path={item.path}
            oldText={item.oldText}
            newText={item.newText}
          />
        ) : (
          <TextContent key={`${item.text}-${index}`} text={item.text} />
        ),
      )}
    </div>
  );
}
