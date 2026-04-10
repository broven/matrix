import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { isLoopbackRequest } from "../index.js";

describe("Loopback CSRF Security", () => {
  let app: Hono;
  const serverToken = "test-token";

  beforeEach(() => {
    app = new Hono();
    // Replicate the fixed server setup
    app.use("/*", cors({
      origin: (origin) => origin || "*",
      allowHeaders: ["Authorization", "Content-Type", "X-Matrix-Internal"],
    }));

    const localOriginPrefixes = ["http://localhost:", "http://127.0.0.1:", "http://[::1]:"];
    const originCheckMiddleware = async (c: any, next: any) => {
      const origin = c.req.header("Origin");
      if (origin && !localOriginPrefixes.some(p => origin.startsWith(p))) {
        return c.json({ error: "Forbidden Origin" }, 403);
      }
      await next();
    };
    app.use("/api/auth-info", originCheckMiddleware);

    app.get("/api/auth-info", (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: serverToken });
    });
  });

  it("FIXED: /api/auth-info rejects malicious Origin", async () => {
    // We simulate a request from a malicious site
    const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "https://malicious.com",
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
    const body = await res.json() as any;
    expect(body.error).toBe("Forbidden Origin");
  });

  it("FIXED: /api/auth-info rejects missing X-Matrix-Internal header", async () => {
     const res = await app.request("/api/auth-info", {
      headers: {
        "Origin": "http://localhost:3000",
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

  it("isLoopbackRequest correctly identifies 127.0.0.1 with header", async () => {
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
  });

  it("isLoopbackRequest correctly identifies ::1 with header", async () => {
     const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
      },
     }, {
      incoming: {
        socket: {
          remoteAddress: "::1",
        },
      },
    } as any);
    expect(res.status).toBe(200);
  });

  it("isLoopbackRequest rejects external IP", async () => {
     const res = await app.request("/api/auth-info", {}, {
      incoming: {
        socket: {
          remoteAddress: "1.2.3.4",
        },
      },
    } as any);
    expect(res.status).toBe(403);
  });
});
