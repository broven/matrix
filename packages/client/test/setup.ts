import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = () => {};

// ProseMirror requires getClientRects / getBoundingClientRect on Range and Element
// jsdom does not implement these, so we polyfill them for tests.
const dummyRect = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList);
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => dummyRect;
}
if (!Element.prototype.getClientRects) {
  Element.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList);
}

// jsdom doesn't implement DOMRect constructor used by ProseMirror
if (typeof globalThis.DOMRect === "undefined") {
  (globalThis as any).DOMRect = class DOMRect {
    x = 0; y = 0; width = 0; height = 0;
    top = 0; right = 0; bottom = 0; left = 0;
    constructor(x = 0, y = 0, w = 0, h = 0) {
      this.x = x; this.y = y; this.width = w; this.height = h;
      this.top = y; this.left = x; this.right = x + w; this.bottom = y + h;
    }
    toJSON() { return {}; }
  };
}
