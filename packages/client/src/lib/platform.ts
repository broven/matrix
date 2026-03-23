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

export function isMacOS(): boolean {
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

let cachedLocalServerUrl: string | null = null;

/**
 * Get the local sidecar server URL. In dev mode this is set via SIDECAR_URL
 * (portless proxy URL); in release mode it's always http://127.0.0.1:19880.
 */
export async function getLocalServerUrl(): Promise<string> {
  if (cachedLocalServerUrl) return cachedLocalServerUrl;

  if (!hasLocalServer()) {
    cachedLocalServerUrl = "http://127.0.0.1:19880";
    return cachedLocalServerUrl;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const url = await invoke<string>("get_sidecar_url");
    cachedLocalServerUrl = url;
    return cachedLocalServerUrl;
  } catch {
    // Don't cache on failure — allow retry on next call
    return "http://127.0.0.1:19880";
  }
}
