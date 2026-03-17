import os from "node:os";

export function buildConnectionUri(serverUrl: string, token: string): string {
  const params = new URLSearchParams({
    serverUrl,
    token,
  });

  return `matrix://connect?${params.toString()}`;
}

/**
 * Returns the first non-loopback IPv4 address found on any network interface.
 * Used by the local sidecar to advertise a LAN-reachable address.
 */
export function getLocalIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}
