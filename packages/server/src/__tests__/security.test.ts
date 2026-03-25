import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isLoopbackRequest } from "../index.js";

describe("Security Enhancements", () => {
  it("should block loopback requests without X-Matrix-Internal header", async () => {
    const app = new Hono();
    app.get("/api/auth-info", (c) => {
      // Simulate remote address from Hono context
      // In the real app, this is in c.env.incoming.socket.remoteAddress
      c.env = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: "secret" });
    });

    const res = await app.request("/api/auth-info");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Forbidden" });
  });

  it("should allow loopback requests with X-Matrix-Internal header", async () => {
    const app = new Hono();
    app.get("/api/auth-info", (c) => {
      c.env = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: "secret" });
    });

    const res = await app.request("/api/auth-info", {
      headers: { "X-Matrix-Internal": "true" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ token: "secret" });
  });

  it("should block non-loopback requests even with X-Matrix-Internal header", async () => {
    const app = new Hono();
    app.get("/api/auth-info", (c) => {
      c.env = { incoming: { socket: { remoteAddress: "192.168.1.5" } } };
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: "secret" });
    });

    const res = await app.request("/api/auth-info", {
      headers: { "X-Matrix-Internal": "true" },
    });
    expect(res.status).toBe(403);
  });

  it("should restrict CORS allowed headers and exclude X-Matrix-Internal", async () => {
    const app = new Hono();
    app.use(
      "/*",
      cors({
        origin: (origin) => origin || "*",
        allowHeaders: ["Content-Type", "Authorization"],
      }),
    );

    // Preflight request asking for X-Matrix-Internal
    const res = await app.request("/api/any", {
      method: "OPTIONS",
      headers: {
        "Origin": "http://malicious.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Matrix-Internal",
      },
    });

    expect(res.status).toBe(204);
    const allowedHeaders = res.headers.get("Access-Control-Allow-Headers");

    // If the header is restricted, it should either be null or NOT contain X-Matrix-Internal
    if (allowedHeaders !== null) {
      const headers = allowedHeaders.split(",").map(h => h.trim().toLowerCase());
      expect(headers).not.toContain("x-matrix-internal");
    }
  });
});
