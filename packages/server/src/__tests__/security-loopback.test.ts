import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { localOriginMiddleware, isLoopbackRequest } from "../index.js";

describe("Loopback Security", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.get("/api/auth-info", localOriginMiddleware, (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: "secret-token" });
    });
  });

  it("rejects requests from non-loopback IPs", async () => {
    const res = await app.request("/api/auth-info", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "192.168.1.1" } }
    } as any);
    expect(res.status).toBe(403);
  });

  it("rejects requests missing X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {}, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);
    expect(res.status).toBe(403);
  });

  it("rejects requests with non-local Origin", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "http://malicious.com"
      }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Non-local origin");
  });

  it("allows requests from localhost Origin", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "http://localhost:5173"
      }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("secret-token");
  });

  it("allows requests from tauri:// Origin", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "tauri://localhost"
      }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);
    expect(res.status).toBe(200);
  });

  it("allows requests with no Origin (direct client)", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);
    expect(res.status).toBe(200);
  });
});
