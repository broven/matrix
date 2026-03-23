import type { Graphviz } from "@hpcc-js/wasm-graphviz";

const DIAGRAM_LANGUAGES = new Set(["mermaid", "dot", "graphviz"]);

export function isDiagramLanguage(lang: string | undefined): boolean {
  return !!lang && DIAGRAM_LANGUAGES.has(lang);
}

let mermaidInstance: typeof import("mermaid") | null = null;
let mermaidInitialized = false;

async function getMermaid() {
  if (!mermaidInstance) {
    mermaidInstance = await import("mermaid");
  }
  if (!mermaidInitialized) {
    const isDark = document.documentElement.classList.contains("dark");
    mermaidInstance.default.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      suppressErrorRendering: true,
    });
    mermaidInitialized = true;
  }
  return mermaidInstance.default;
}

export function resetMermaidTheme() {
  mermaidInitialized = false;
}

export async function renderMermaid(id: string, source: string): Promise<string> {
  const mermaid = await getMermaid();
  const { svg } = await mermaid.render(id, source);
  return svg;
}

let graphvizInstance: Graphviz | null = null;

async function getGraphviz() {
  if (!graphvizInstance) {
    const { Graphviz } = await import("@hpcc-js/wasm-graphviz");
    graphvizInstance = await Graphviz.load();
  }
  return graphvizInstance;
}

export async function renderGraphviz(source: string): Promise<string> {
  const graphviz = await getGraphviz();
  return graphviz.dot(source);
}
