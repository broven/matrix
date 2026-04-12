import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";

// Use the actual implementation from index.ts
import { isLoopbackRequest } from "../index.js";

describe("Security: Localhost CSRF / DNS Rebinding", () => {
  let app: Hono;
  const serverToken = "secret-token";

  beforeEach(() => {
    app = new Hono();

    // Updated CORS setup
    app.use("/*", cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["X-Matrix-Internal", "Content-Type", "Authorization"],
    }));

    // Updated endpoint using the fixed isLoopbackRequest
    app.get("/api/auth-info", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: serverToken });
    });
  });

  it("FIXED: blocks cross-origin requests from malicious sites", async () => {
    // Simulate a request from a malicious website
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://malicious.com",
        "X-Matrix-Internal": "true",
      },
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1",
        },
      },
    } as any);

    expect(res.status).toBe(403);
  });

  it("FIXED: blocks requests without X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {}, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1",
        },
      },
    } as any);

    expect(res.status).toBe(403);
  });

  it("ALLOWED: allows requests from local origin with X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://localhost:3000",
        "X-Matrix-Internal": "true",
      },
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1",
        },
      },
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(serverToken);
  });

  it("ALLOWED: allows non-browser requests (no Origin) with X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
      },
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1",
        },
      },
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe(serverToken);
  });
});
