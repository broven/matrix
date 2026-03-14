export function buildConnectionUri(serverUrl: string, token: string): string {
  const params = new URLSearchParams({
    serverUrl,
    token,
  });

  return `matrix://connect?${params.toString()}`;
}
