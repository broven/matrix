import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";

// Mocking the behavior from updated index.ts
export function isLoopbackRequest(c: any): boolean {
  const addr: string | undefined = c.env?.incoming?.socket?.remoteAddress;
  if (!addr) return false;
  const isLoopbackIp = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  const hasInternalHeader = c.req.header("X-Matrix-Internal") === "true";
  return isLoopbackIp && hasInternalHeader;
}

const loopbackSecurityMiddleware = () => {
  return async (c: any, next: any) => {
    const origin = c.req.header("Origin");
    if (origin) {
      const isLocalOrigin = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
      if (!isLocalOrigin) {
        return c.json({ error: "Forbidden: Untrusted Origin" }, 403);
      }
    }

    if (!isLoopbackRequest(c)) {
      return c.json({ error: "Forbidden: Loopback only" }, 403);
    }
    await next();
  };
};

describe("Security: Loopback Endpoints (Fixed)", () => {
  let app: Hono;
  const serverToken = "test-token";

  beforeEach(() => {
    app = new Hono();
    // Replicate the permissive CORS from index.ts, including the new allowHeaders
    app.use("/*", cors({
        origin: (origin) => origin || "*",
        allowHeaders: ["Authorization", "Content-Type", "X-Matrix-Internal"],
    }));

    app.get("/api/auth-info", loopbackSecurityMiddleware(), (c) => {
      return c.json({ token: serverToken });
    });
  });

  it("allows access from loopback IP with internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(serverToken);
  });

  it("denies access from loopback IP WITHOUT internal header", async () => {
    const res = await app.request("/api/auth-info", {}, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    });
    expect(res.status).toBe(403);
  });

  it("denies access from non-loopback IP even with internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "192.168.1.1" } }
    });
    expect(res.status).toBe(403);
  });

  it("FIXED: denies access from malicious origin even with loopback IP and internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://malicious.com",
        "X-Matrix-Internal": "true",
      }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Untrusted Origin");
  });

  it("allows access from local origin (localhost) with internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://localhost:3000",
        "X-Matrix-Internal": "true",
      }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    });

    expect(res.status).toBe(200);
  });
});
