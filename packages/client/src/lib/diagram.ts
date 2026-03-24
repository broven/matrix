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

/**
 * Strip dangerous content from rendered SVG to prevent XSS.
 * Removes script elements, javascript:/data: URIs, and event-handler attributes.
 */
function sanitizeSvg(raw: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "image/svg+xml");

  // Remove <script> elements
  for (const el of Array.from(doc.querySelectorAll("script"))) {
    el.remove();
  }

  // Remove <foreignObject> (can embed arbitrary HTML)
  for (const el of Array.from(doc.querySelectorAll("foreignObject"))) {
    el.remove();
  }

  const dangerous = /^\s*(javascript|data)\s*:/i;

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      // Strip event handlers (onclick, onload, etc.)
      if (attr.name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      // Strip dangerous URIs from href / xlink:href / src / action / formaction
      if (/^(href|xlink:href|src|action|formaction)$/i.test(attr.name)) {
        if (dangerous.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  const svg = doc.querySelector("svg");
  return svg ? svg.outerHTML : "";
}

export async function renderGraphviz(source: string): Promise<string> {
  const graphviz = await getGraphviz();
  const raw = graphviz.dot(source);
  return sanitizeSvg(raw);
}
