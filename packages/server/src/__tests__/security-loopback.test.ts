import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isLoopbackRequest } from "../index.js";

describe("Loopback Security", () => {
  let app: Hono;
  const serverToken = "test-token";

  beforeEach(() => {
    app = new Hono();

    // Exact same CORS config as in index.ts
    app.use(
      "/*",
      cors({
        origin: (origin) => origin || "*",
        allowHeaders: ["Content-Type", "Authorization"],
      }),
    );

    app.get("/api/auth-info", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: serverToken });
    });
  });

  it("rejects loopback request without X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {}, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  it("accepts loopback request with X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(serverToken);
  });

  it("rejects non-loopback request even with X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "1.2.3.4" } }
    } as any);

    expect(res.status).toBe(403);
  });

  it("CORS does not allow X-Matrix-Internal header", async () => {
    // Preflight request
    const res = await app.request("/api/auth-info", {
      method: "OPTIONS",
      headers: {
        "Origin": "https://malicious.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Matrix-Internal"
      }
    });

    // If it's NOT in allowHeaders, the browser should block the actual request
    // Hono's cors middleware returns 204 or 200 for OPTIONS
    // We check if the response header Access-Control-Allow-Headers includes X-Matrix-Internal
    const allowedHeaders = res.headers.get("Access-Control-Allow-Headers");
    if (allowedHeaders) {
      const headersArray = allowedHeaders.split(",").map(h => h.trim().toLowerCase());
      expect(headersArray).not.toContain("x-matrix-internal");
    }
  });
});
