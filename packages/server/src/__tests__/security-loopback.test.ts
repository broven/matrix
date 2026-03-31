import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { isLoopbackRequest } from "../index.js";

describe("Security: Loopback Protection", () => {
  it("rejects request without X-Matrix-Internal header even on loopback", async () => {
    const app = new Hono();
    app.get("/test", (c) => {
      if (!isLoopbackRequest(c)) return c.json({ error: "Forbidden" }, 403);
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {}, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("accepts request with X-Matrix-Internal header on loopback", async () => {
    const app = new Hono();
    app.get("/test", (c) => {
      if (!isLoopbackRequest(c)) return c.json({ error: "Forbidden" }, 403);
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "127.0.0.1" } }
    } as any);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects request with X-Matrix-Internal header NOT on loopback", async () => {
    const app = new Hono();
    app.get("/test", (c) => {
      if (!isLoopbackRequest(c)) return c.json({ error: "Forbidden" }, 403);
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {
      headers: { "X-Matrix-Internal": "true" }
    }, {
      incoming: { socket: { remoteAddress: "1.2.3.4" } }
    } as any);

    expect(res.status).toBe(403);
  });
});
