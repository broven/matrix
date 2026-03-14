import { useMatrixClient } from "../hooks/useMatrixClient";
import type { ConnectionStatus } from "@matrix/protocol";

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; bg: string; fg: string }> = {
  connected: { label: "Connected", bg: "#22c55e", fg: "#fff" },
  connecting: { label: "Connecting\u2026", bg: "#3b82f6", fg: "#fff" },
  reconnecting: { label: "Reconnecting\u2026", bg: "#f59e0b", fg: "#000" },
  degraded: { label: "Degraded (SSE)", bg: "#eab308", fg: "#000" },
  offline: { label: "Offline", bg: "#6b7280", fg: "#fff" },
};

export function ConnectionStatusBar() {
  const { status } = useMatrixClient();
  const config = STATUS_CONFIG[status];

  return (
    <div
      style={{
        width: "100%",
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: config.bg,
        color: config.fg,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.3,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: config.fg,
          opacity: 0.7,
          marginRight: 6,
        }}
      />
      {config.label}
    </div>
  );
}
