import { expect, test, describe } from "bun:test";
import { Hono } from "hono";

// We want to test the logic of isLoopbackRequest and how it's used in the routes.
// Since we can't easily import the app from index.ts without starting the server,
// we will recreate the relevant parts for the test.

import { isLoopbackRequest } from "../index.js";

describe("Loopback Security", () => {
  const app = new Hono();
  const serverToken = "test-token";

  app.get("/api/auth-info", (c) => {
    if (!isLoopbackRequest(c)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    return c.json({ token: serverToken });
  });

  test("should forbid loopback request without custom header", async () => {
    const res = await app.request("/api/auth-info", {}, {
      incoming: {
        socket: {
          remoteAddress: "127.0.0.1"
        }
      }
    } as any);

    expect(res.status).toBe(403);
  });

  test("should allow loopback request with custom header", async () => {
    const res = await app.request("/api/auth-info", {
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
    const body = await res.json();
    expect(body.token).toBe(serverToken);
  });

  test("should forbid non-loopback request", async () => {
    const res = await app.request("/api/auth-info", {}, {
      incoming: {
        socket: {
          remoteAddress: "1.2.3.4"
        }
      }
    } as any);

    expect(res.status).toBe(403);
  });
});
