import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { isLoopbackRequest, localOriginMiddleware } from "../index.js";

describe("Security: Loopback Endpoints Fix", () => {
  let app: Hono;
  const serverToken = "test-token";

  beforeEach(() => {
    app = new Hono();

    app.get("/api/auth-info", localOriginMiddleware, (c) => {
      // In tests, we need to pass the token somehow or mock it.
      // For this test, we just want to verify the middleware and isLoopbackRequest.
      if (!isLoopbackRequest(c)) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return c.json({ token: serverToken });
    });
  });

  it("blocks loopback request WITH malicious Origin header", async () => {
    const req = new Request("http://localhost/api/auth-info", {
      headers: {
        "Origin": "http://evil.com",
        "X-Matrix-Internal": "true"
      }
    });

    const res = await app.request(req, undefined, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    });

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toBe("Forbidden: Untrusted Origin");
  });

  it("blocks loopback request WITHOUT X-Matrix-Internal header", async () => {
    const req = new Request("http://localhost/api/auth-info", {
        headers: {
            "Origin": "http://localhost:5173"
        }
    });

    const res = await app.request(req, undefined, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    });

    expect(res.status).toBe(403);
  });

  it("allows loopback request with trusted Origin AND X-Matrix-Internal header", async () => {
    const req = new Request("http://localhost/api/auth-info", {
      headers: {
        "Origin": "http://localhost:5173",
        "X-Matrix-Internal": "true"
      }
    });

    const res = await app.request(req, undefined, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.token).toBe(serverToken);
  });

  it("allows loopback request without Origin header AND with X-Matrix-Internal header (e.g. from curl or local app)", async () => {
    const req = new Request("http://localhost/api/auth-info", {
      headers: {
        "X-Matrix-Internal": "true"
      }
    });

    const res = await app.request(req, undefined, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    });

    expect(res.status).toBe(200);
  });
});
