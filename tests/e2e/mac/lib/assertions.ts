import { expect } from "vitest";
import { getText, isVisible, waitFor, count } from "./ui";

/** Assert that an element matching the selector is present in the DOM. */
export async function expectVisible(selector: string): Promise<void> {
  const visible = await isVisible(selector);
  expect(visible, `Expected element "${selector}" to be visible`).toBe(true);
}

/** Assert that an element matching the selector is NOT present in the DOM. */
export async function expectNotVisible(selector: string): Promise<void> {
  const visible = await isVisible(selector);
  expect(visible, `Expected element "${selector}" to not be visible`).toBe(false);
}

/** Assert that the text content of an element contains the expected string. */
export async function expectText(
  selector: string,
  expected: string,
): Promise<void> {
  const text = await getText(selector);
  expect(text).toContain(expected);
}

/** Assert that an element becomes visible within the timeout. */
export async function expectEventuallyVisible(
  selector: string,
  opts?: { timeout?: number },
): Promise<void> {
  await waitFor(selector, opts);
}

/** Assert that the number of elements matching the selector equals expected. */
export async function expectCount(
  selector: string,
  expected: number,
): Promise<void> {
  const actual = await count(selector);
  expect(actual, `Expected ${expected} elements for "${selector}", got ${actual}`).toBe(expected);
}
