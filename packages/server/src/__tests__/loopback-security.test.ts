import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { isLoopbackRequest } from "../index.js";

describe("isLoopbackRequest security", () => {
  let c: any;

  beforeEach(() => {
    c = {
      env: {
        incoming: {
          socket: {
            remoteAddress: "127.0.0.1",
          },
        },
      },
      req: {
        header: (name: string) => (c.headers && c.headers[name]) || undefined,
      },
      headers: {},
    };
  });

  it("rejects loopback request without X-Matrix-Internal header", () => {
    expect(isLoopbackRequest(c)).toBe(false);
  });

  it("accepts loopback request with X-Matrix-Internal: true header", () => {
    c.headers["X-Matrix-Internal"] = "true";
    expect(isLoopbackRequest(c)).toBe(true);
  });

  it("rejects non-loopback request even with X-Matrix-Internal header", () => {
    c.env.incoming.socket.remoteAddress = "1.2.3.4";
    c.headers["X-Matrix-Internal"] = "true";
    expect(isLoopbackRequest(c)).toBe(false);
  });

  it("rejects loopback request with wrong X-Matrix-Internal header value", () => {
    c.headers["X-Matrix-Internal"] = "false";
    expect(isLoopbackRequest(c)).toBe(false);
  });
});
