import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { isLoopbackRequest } from "../index.js";

describe("Loopback Security", () => {
  it("rejects loopback requests without X-Matrix-Internal header", async () => {
    const app = new Hono();
    app.get("/test", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {
      method: "GET",
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    } as any);

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Forbidden");
  });

  it("accepts loopback requests with X-Matrix-Internal header", async () => {
    const app = new Hono();
    app.get("/test", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {
      method: "GET",
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
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("rejects non-loopback requests even with X-Matrix-Internal header", async () => {
    const app = new Hono();
    app.get("/test", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {
      method: "GET",
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
});
