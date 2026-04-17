import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { localOriginMiddleware, isLoopbackRequest } from "../index.js";

describe("Security: Loopback Endpoints", () => {
  let app: Hono;
  const mockToken = "test-token";

  beforeAll(() => {
    app = new Hono();
    app.use(
      "/*",
      cors({
        origin: (origin) => origin || "*",
        allowHeaders: ["Content-Type", "Authorization", "X-Matrix-Internal"],
      })
    );

    app.get("/api/auth-info", localOriginMiddleware, (c) => {
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: mockToken });
    });
  });

  it("allows request with loopback IP and X-Matrix-Internal header", async () => {
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
    const data = await res.json() as any;
    expect(data.token).toBe(mockToken);
  });

  it("rejects request missing X-Matrix-Internal header", async () => {
    const res = await app.request("/api/auth-info", {}, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1",
        },
      },
    } as any);

    expect(res.status).toBe(403);
  });

  it("rejects request from non-loopback IP even with header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
      },
    }, {
      incoming: {
        socket: {
          remoteAddress: "192.168.1.1",
        },
      },
    } as any);

    expect(res.status).toBe(403);
  });

  it("rejects request with untrusted Origin header", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "http://malicious.com",
      },
    }, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1",
        },
      },
    } as any);

    expect(res.status).toBe(403);
    const data = await res.json() as any;
    expect(data.error).toBe("Forbidden cross-origin request");
  });

  it("allows request with trusted Origin header (localhost)", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "http://localhost:5173",
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

  it("allows request with trusted Origin header (tauri)", async () => {
    const res = await app.request("/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true",
        "Origin": "tauri://localhost",
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
});
