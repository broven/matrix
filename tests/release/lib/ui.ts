import type { BridgeClient } from "./bridge-client";

const DEFAULT_TIMEOUT = 10_000;
const POLL_INTERVAL = 200;

let _bridge: BridgeClient;

export function setBridge(bridge: BridgeClient) {
  _bridge = bridge;
}

function bridge(): BridgeClient {
  if (!_bridge) throw new Error("UI bridge not initialized — call setBridge() first");
  return _bridge;
}

/** Click an element matching the given CSS selector. */
export async function click(selector: string): Promise<void> {
  await bridge().eval(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('click: element not found: ' + ${JSON.stringify(selector)});
      el.click();
    })()
  `);
}

/** Type text into an input/textarea matching the given CSS selector. */
export async function type(selector: string, text: string): Promise<void> {
  await bridge().eval(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('type: element not found: ' + ${JSON.stringify(selector)});
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, ${JSON.stringify(text)});
      } else {
        el.value = ${JSON.stringify(text)};
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
}

/** Wait until an element matching the selector exists in the DOM. */
export async function waitFor(
  selector: string,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  await bridge().wait(
    { kind: "webview.eval", script: `!!document.querySelector(${JSON.stringify(selector)})` },
    { timeoutMs: timeout, intervalMs: POLL_INTERVAL },
  );
}

/** Wait until an element matching the selector is removed from the DOM. */
export async function waitForGone(
  selector: string,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  await bridge().wait(
    { kind: "webview.eval", script: `!document.querySelector(${JSON.stringify(selector)})` },
    { timeoutMs: timeout, intervalMs: POLL_INTERVAL },
  );
}

/** Get the text content of an element matching the selector. */
export async function getText(selector: string): Promise<string> {
  const result = await bridge().eval(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('getText: element not found: ' + ${JSON.stringify(selector)});
      return el.textContent || '';
    })()
  `);
  return result as string;
}

/** Check if an element matching the selector is currently in the DOM. */
export async function isVisible(selector: string): Promise<boolean> {
  const result = await bridge().eval(
    `!!document.querySelector(${JSON.stringify(selector)})`,
  );
  return result as boolean;
}

/** Get the value of an input/textarea matching the selector. */
export async function getValue(selector: string): Promise<string> {
  const result = await bridge().eval(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('getValue: element not found: ' + ${JSON.stringify(selector)});
      return el.value || '';
    })()
  `);
  return result as string;
}

/** Count elements matching the selector. */
export async function count(selector: string): Promise<number> {
  const result = await bridge().eval(
    `document.querySelectorAll(${JSON.stringify(selector)}).length`,
  );
  return result as number;
}
