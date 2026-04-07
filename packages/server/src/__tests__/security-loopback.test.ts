import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { isLoopbackRequest } from "../index.js";
import { createMiddleware } from "hono/factory";

describe("isLoopbackRequest protection", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    const loopbackCorsMiddleware = createMiddleware(async (c, next) => {
      const origin = c.req.header("Origin");
      if (origin && !origin.startsWith("http://localhost:") && !origin.startsWith("http://127.0.0.1:")) {
        return c.json({ error: "Forbidden: Cross-origin access denied" }, 403);
      }
      await next();
    });

    app.get("/test-loopback", loopbackCorsMiddleware, (c) => {
      if (isLoopbackRequest(c)) {
        return c.json({ ok: true });
      }
      return c.json({ error: "forbidden" }, 403);
    });
  });

  it("identifies loopback address correctly (with internal header)", async () => {
    const res = await app.request("/test-loopback", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    });
    expect(res.status).toBe(200);
  });

  it("rejects non-loopback address", async () => {
    const res = await app.request("/test-loopback", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "8.8.8.8"
        }
      }
    });
    expect(res.status).toBe(403);
  });

  it("vulnerability fix: rejects loopback with external Origin header", async () => {
    const res = await app.request("/test-loopback", {
      headers: {
        "Origin": "http://evil.com",
        "X-Matrix-Internal": "true"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    });
    expect(res.status).toBe(403);
  });

  it("fix: requires X-Matrix-Internal header", async () => {
    const res = await app.request("/test-loopback", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    });
    expect(res.status).toBe(200);
  });

  it("fix: rejects loopback without X-Matrix-Internal header", async () => {
    const res = await app.request("/test-loopback", {}, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    });
    expect(res.status).toBe(403);
  });
});
