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
 * Get the local sidecar server URL. In dev mode the port may be overridden
 * via SIDECAR_PORT env var; in release mode it's always 19880.
 */
export async function getLocalServerUrl(): Promise<string> {
  if (cachedLocalServerUrl) return cachedLocalServerUrl;

  if (!hasLocalServer()) {
    cachedLocalServerUrl = "http://127.0.0.1:19880";
    return cachedLocalServerUrl;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = await invoke<number>("get_sidecar_port");
    cachedLocalServerUrl = `http://127.0.0.1:${port}`;
    return cachedLocalServerUrl;
  } catch {
    // Don't cache on failure — allow retry on next call
    return "http://127.0.0.1:19880";
  }
}
