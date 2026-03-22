// Normalize a KeyboardEvent into sorted key array matching our store format
export function eventToKeys(e: KeyboardEvent): string[] {
  const keys: string[] = [];
  if (e.ctrlKey) keys.push("Control");
  if (e.shiftKey) keys.push("Shift");
  if (e.altKey) keys.push("Alt");
  if (e.metaKey) keys.push("Meta");

  // Don't add modifier-only keys as the main key
  const modifierKeys = new Set(["Control", "Shift", "Alt", "Meta"]);
  if (!modifierKeys.has(e.key)) {
    // Normalize single characters to lowercase for consistent matching
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.push(key);
  }

  return keys;
}

export function keysMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((key, i) => key === sortedB[i]);
}
