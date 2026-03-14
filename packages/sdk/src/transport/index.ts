import type { TransportMode, ServerMessage, ClientMessage, ConnectionStatus } from "@matrix/protocol";

export interface TransportConfig {
  serverUrl: string;
  token: string;
  mode: TransportMode;
}

export type TransportEventHandler = {
  onMessage: (message: ServerMessage) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onError: (error: Error) => void;
};

export interface Transport {
  type: TransportMode;
  connect(handlers: TransportEventHandler): void;
  send(message: ClientMessage): void;
  disconnect(): void;
  getLastEventId(): string | undefined;
}

export function createTransport(config: TransportConfig): Transport {
  switch (config.mode) {
    case "websocket":
      return new WebSocketTransport(config);
    case "sse":
      return new SseTransport(config);
    case "polling":
      return new PollingTransport(config);
    case "auto":
      return new WebSocketTransport(config);
  }
}

export const MAX_QUEUED_MESSAGES = 50;

class WebSocketTransport implements Transport {
  type = "websocket" as const;
  private ws: WebSocket | null = null;
  private handlers: TransportEventHandler | null = null;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 30000;
  private lastEventId = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private pendingMessages: ClientMessage[] = [];

  constructor(private config: TransportConfig) {}

  connect(handlers: TransportEventHandler): void {
    this.handlers = handlers;
    this.doConnect();
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      if (this.pendingMessages.length >= MAX_QUEUED_MESSAGES) {
        this.pendingMessages.shift(); // drop oldest
      }
      this.pendingMessages.push(message);
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.pendingMessages = [];
    this.ws?.close();
    this.ws = null;
  }

  getLastEventId(): string | undefined {
    return this.lastEventId > 0 ? String(this.lastEventId) : undefined;
  }

  private doConnect(): void {
    this.handlers?.onStatusChange(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const wsUrl = this.config.serverUrl.replace(/^http/, "ws") + "/ws";
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      // Send auth token as first message instead of in query string
      this.ws!.send(JSON.stringify({ type: "auth", token: this.config.token }));
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "authenticated") {
          this.reconnectAttempt = 0;
          this.handlers?.onStatusChange("connected");
          this.startHeartbeat();
          this.flushPendingMessages();
          return;
        }
        if (msg.eventId) this.lastEventId = parseInt(msg.eventId, 10);
        if (msg.type === "pong") return;
        this.handlers?.onMessage(msg);
      } catch {
        this.handlers?.onError(new Error("Failed to parse server message"));
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.handlers?.onError(new Error("WebSocket error"));
    };
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt - 1), this.maxReconnectDelay);
    this.handlers?.onStatusChange("reconnecting");
    setTimeout(() => this.doConnect(), delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: "ping" });
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private flushPendingMessages(): void {
    const messages = this.pendingMessages;
    this.pendingMessages = [];
    for (const msg of messages) {
      this.send(msg);
    }
  }
}

class SseTransport implements Transport {
  type = "sse" as const;
  private eventSource: EventSource | null = null;
  private handlers: TransportEventHandler | null = null;

  constructor(private config: TransportConfig) {}

  connect(handlers: TransportEventHandler): void {
    this.handlers = handlers;
    handlers.onStatusChange("connecting");
    const url = `${this.config.serverUrl}/sse?token=${this.config.token}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => handlers.onStatusChange("degraded");
    this.eventSource.onmessage = (event) => {
      try { handlers.onMessage(JSON.parse(event.data)); } catch {}
    };
    this.eventSource.onerror = () => handlers.onStatusChange("reconnecting");
  }

  send(message: ClientMessage): void {
    fetch(`${this.config.serverUrl}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.token}` },
      body: JSON.stringify(message),
    }).catch(() => {});
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  getLastEventId(): string | undefined {
    return undefined;
  }
}

class PollingTransport implements Transport {
  type = "polling" as const;
  private handlers: TransportEventHandler | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastEventId = 0;

  constructor(private config: TransportConfig) {}

  connect(handlers: TransportEventHandler): void {
    this.handlers = handlers;
    handlers.onStatusChange("degraded");
    this.pollInterval = setInterval(() => this.poll(), 2000);
  }

  send(message: ClientMessage): void {
    fetch(`${this.config.serverUrl}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.token}` },
      body: JSON.stringify(message),
    }).catch(() => {});
  }

  disconnect(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  getLastEventId(): string | undefined {
    return this.lastEventId > 0 ? String(this.lastEventId) : undefined;
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(
        `${this.config.serverUrl}/poll?lastEventId=${this.lastEventId}`,
        { headers: { Authorization: `Bearer ${this.config.token}` } },
      );
      const messages = await res.json();
      for (const msg of messages) {
        if (msg.eventId) this.lastEventId = parseInt(msg.eventId, 10);
        this.handlers?.onMessage(msg);
      }
    } catch {}
  }
}
