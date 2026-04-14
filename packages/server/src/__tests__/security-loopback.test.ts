import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { isLoopbackRequest, localOriginMiddleware } from "../index.js";

describe("Loopback Security", () => {
  const app = new Hono();

  app.get("/test-loopback", (c) => {
    if (!isLoopbackRequest(c)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return c.json({ ok: true });
  });

  app.get("/test-origin", localOriginMiddleware, (c) => {
    return c.json({ ok: true });
  });

  it("isLoopbackRequest: rejects request without X-Matrix-Internal header", async () => {
    const res = await app.request("/test-loopback", {
      headers: {
        // Missing X-Matrix-Internal
      }
    }, {
        incoming: {
            socket: {
                remoteAddress: "127.0.0.1"
            }
        }
    } as any);
    expect(res.status).toBe(403);
  });

  it("isLoopbackRequest: accepts request with X-Matrix-Internal header and loopback IP", async () => {
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
    } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("isLoopbackRequest: rejects request with header but non-loopback IP", async () => {
    const res = await app.request("/test-loopback", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    }, {
        incoming: {
            socket: {
                remoteAddress: "192.168.1.1"
            }
        }
    } as any);
    expect(res.status).toBe(403);
  });

  it("localOriginMiddleware: rejects non-local Origin", async () => {
    const res = await app.request("/test-origin", {
      headers: {
        "Origin": "http://evil.com"
      }
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden: Cross-origin request blocked" });
  });

  it("localOriginMiddleware: accepts local Origin (localhost)", async () => {
    const res = await app.request("/test-origin", {
      headers: {
        "Origin": "http://localhost:5173"
      }
    });
    expect(res.status).toBe(200);
  });

  it("localOriginMiddleware: accepts local Origin (127.0.0.1)", async () => {
    const res = await app.request("/test-origin", {
      headers: {
        "Origin": "http://127.0.0.1:5173"
      }
    });
    expect(res.status).toBe(200);
  });

  it("localOriginMiddleware: accepts request without Origin header (non-browser)", async () => {
    const res = await app.request("/test-origin", {
      headers: {}
    });
    expect(res.status).toBe(200);
  });
});
