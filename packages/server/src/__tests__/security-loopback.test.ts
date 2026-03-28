import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isLoopbackRequest } from "../index.js";

describe("Loopback security", () => {
  it("rejects loopback request missing X-Matrix-Internal header", async () => {
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
          remoteAddress: "127.0.0.1",
        },
      },
    } as any);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  it("accepts loopback request with X-Matrix-Internal: true header", async () => {
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
    expect(body.ok).toBe(true);
  });

  it("rejects non-loopback request even with X-Matrix-Internal: true header", async () => {
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
        "X-Matrix-Internal": "true",
      },
    }, {
      incoming: {
        socket: {
          remoteAddress: "1.2.3.4",
        },
      },
    } as any);

    expect(res.status).toBe(403);
  });
});

describe("CORS security", () => {
  it("does not include X-Matrix-Internal in Access-Control-Allow-Headers", async () => {
    const app = new Hono();
    app.use("/*", cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["Content-Type", "Authorization"],
    }));

    const res = await app.request("/any", {
      method: "OPTIONS",
      headers: {
        "Origin": "https://malicious.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Matrix-Internal",
      },
    });

    expect(res.status).toBe(204);
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers");
    if (allowHeaders) {
      const headers = allowHeaders.split(",").map(h => h.trim());
      expect(headers).not.toContain("X-Matrix-Internal");
    }
  });
});
