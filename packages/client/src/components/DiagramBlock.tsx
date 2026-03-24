import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Code, Image, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { renderMermaid, renderGraphviz, resetMermaidTheme } from "@/lib/diagram";
import { cn } from "@/lib/utils";

interface Props {
  language: string;
  source: string;
}

const RENDER_DEBOUNCE_MS = 300;
// Errors are delayed so transient failures during streaming don't flash to the user.
// Source must be stable for at least this long before an error is shown.
const ERROR_DISPLAY_DELAY_MS = 700;
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.2;

export function DiagramBlock({ language, source }: Props) {
  const [mode, setMode] = useState<"diagram" | "source">("diagram");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const instanceId = useId().replace(/:/g, "-");
  const renderCountRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Pan/zoom state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced render — suppresses errors during streaming
  useEffect(() => {
    clearTimeout(debounceRef.current);
    clearTimeout(errorTimerRef.current);
    setRendering(true);
    setError(null); // Clear visible error immediately so stale errors don't flash during streaming
    const currentRender = ++renderCountRef.current; // Increment here to invalidate any in-flight async render

    debounceRef.current = setTimeout(() => {
      async function doRender() {
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
            setRendering(false);
          }
        } catch (err) {
          if (currentRender === renderCountRef.current) {
            const errMsg = err instanceof Error ? err.message : "Failed to render diagram";
            // Delay showing the error: if streaming resumes within this window the timer is
            // cancelled and the error never surfaces, preventing error flashes mid-stream.
            errorTimerRef.current = setTimeout(() => {
              if (currentRender === renderCountRef.current) {
                setError(errMsg);
                setRendering(false);
              }
            }, ERROR_DISPLAY_DELAY_MS);
          }
        }
      }

      doRender();
    }, RENDER_DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(errorTimerRef.current);
    };
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

  // Pan/zoom handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + delta)));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - translate.x, y: e.clientY - translate.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [translate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning) return;
    setTranslate({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
    });
  }, [isPanning]);

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP));
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const isZoomed = scale !== 1 || translate.x !== 0 || translate.y !== 0;

  return (
    <div className="not-prose my-3 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {language === "mermaid" ? "Mermaid" : "Graphviz"}
        </span>
        <div className="flex items-center gap-0.5">
          {svg && mode === "diagram" && (
            <>
              <button
                type="button"
                onClick={zoomOut}
                className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
                aria-label="Zoom out"
                data-testid="diagram-zoom-out"
              >
                <ZoomOut className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={zoomIn}
                className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
                aria-label="Zoom in"
                data-testid="diagram-zoom-in"
              >
                <ZoomIn className="size-3.5" />
              </button>
              {isZoomed && (
                <button
                  type="button"
                  onClick={resetZoom}
                  className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
                  aria-label="Reset zoom"
                  data-testid="diagram-zoom-reset"
                >
                  <Maximize className="size-3.5" />
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setMode(mode === "diagram" ? "source" : "diagram")}
            className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
            data-testid="diagram-toggle"
            aria-label={mode === "diagram" ? "View source" : "View diagram"}
            disabled={!svg && !error && !rendering}
          >
            {mode === "diagram" ? <Code className="size-3.5" /> : <Image className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Show error banner: always in source mode, or in diagram mode when there's no SVG to show */}
      {error && (mode === "source" || !svg) && (
        <div
          className="border-b border-destructive/20 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          data-testid="diagram-error"
        >
          {error}
        </div>
      )}

      {mode === "source" || (mode === "diagram" && !svg && error && !rendering) ? (
        <pre
          className="overflow-x-auto p-3 font-mono text-[0.825rem] leading-relaxed"
          data-testid="diagram-source"
        >
          <code>{source}</code>
        </pre>
      ) : svg && mode === "diagram" ? (
        <div
          ref={containerRef}
          className={cn(
            "overflow-hidden p-3",
            language !== "mermaid" && "dark:invert dark:hue-rotate-180",
            isPanning ? "cursor-grabbing" : "cursor-grab",
          )}
          data-testid="diagram-container"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          <div
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.15s ease-out",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
          {rendering ? "Rendering…" : ""}
        </div>
      )}
    </div>
  );
}
