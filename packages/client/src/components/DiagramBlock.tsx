import { useEffect, useId, useRef, useState } from "react";
import { Code, Image } from "lucide-react";
import { renderMermaid, renderGraphviz, resetMermaidTheme } from "@/lib/diagram";
import { cn } from "@/lib/utils";

interface Props {
  language: string;
  source: string;
}

export function DiagramBlock({ language, source }: Props) {
  const [mode, setMode] = useState<"diagram" | "source">("diagram");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const instanceId = useId().replace(/:/g, "-");
  const renderCountRef = useRef(0);

  useEffect(() => {
    const currentRender = ++renderCountRef.current;

    async function render() {
      try {
        let result: string;
        if (language === "mermaid") {
          result = await renderMermaid(`diagram-${instanceId}-${currentRender}`, source);
        } else {
          result = await renderGraphviz(source);
        }
        if (currentRender === renderCountRef.current) {
          setSvg(result);
          setError(null);
        }
      } catch (err) {
        if (currentRender === renderCountRef.current) {
          setError(err instanceof Error ? err.message : "Failed to render diagram");
          setSvg(null);
          setMode("source");
        }
      }
    }

    render();
  }, [language, source, instanceId]);

  // Re-render mermaid when dark mode changes
  useEffect(() => {
    if (language !== "mermaid" || !source) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "class") {
          resetMermaidTheme();
          const currentRender = ++renderCountRef.current;
          renderMermaid(`diagram-${instanceId}-${currentRender}`, source).then(
            (result) => {
              if (currentRender === renderCountRef.current) {
                setSvg(result);
                setError(null);
              }
            },
            () => {} // ignore errors on theme re-render
          );
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [language, source, instanceId]);

  return (
    <div className="not-prose my-3 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {language === "mermaid" ? "Mermaid" : "Graphviz"}
        </span>
        <button
          type="button"
          onClick={() => setMode(mode === "diagram" ? "source" : "diagram")}
          className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
          data-testid="diagram-toggle"
          aria-label={mode === "diagram" ? "View source" : "View diagram"}
          disabled={!svg}
        >
          {mode === "diagram" ? <Code className="size-3.5" /> : <Image className="size-3.5" />}
        </button>
      </div>

      {error && (
        <div
          className="border-b border-destructive/20 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          data-testid="diagram-error"
        >
          {error}
        </div>
      )}

      {mode === "source" || !svg ? (
        <pre
          className="overflow-x-auto p-3 font-mono text-[0.825rem] leading-relaxed"
          data-testid="diagram-source"
        >
          <code>{source}</code>
        </pre>
      ) : (
        <div
          className={cn(
            "overflow-x-auto p-3",
            language !== "mermaid" && "dark:invert dark:hue-rotate-180",
          )}
          data-testid="diagram-container"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
