export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isMobilePlatform(): boolean {
  if (!isTauri()) return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export function hasLocalServer(): boolean {
  return isTauri() && !isMobilePlatform();
}
