import { describe, it, expect } from "vitest";
import { isLoopbackRequest } from "../index.js";

describe("isLoopbackRequest", () => {
  it("rejects requests missing X-Matrix-Internal header", () => {
    const mockContext = {
      req: {
        header: (name: string) => (name === "X-Matrix-Internal" ? undefined : "127.0.0.1"),
      },
      env: {
        incoming: {
          socket: {
            remoteAddress: "127.0.0.1",
          },
        },
      },
    };
    expect(isLoopbackRequest(mockContext as any)).toBe(false);
  });

  it("rejects requests with wrong X-Matrix-Internal header value", () => {
    const mockContext = {
      req: {
        header: (name: string) => (name === "X-Matrix-Internal" ? "false" : "127.0.0.1"),
      },
      env: {
        incoming: {
          socket: {
            remoteAddress: "127.0.0.1",
          },
        },
      },
    };
    expect(isLoopbackRequest(mockContext as any)).toBe(false);
  });

  it("accepts loopback requests with correct X-Matrix-Internal header", () => {
    const mockContext = {
      req: {
        header: (name: string) => (name === "X-Matrix-Internal" ? "true" : "127.0.0.1"),
      },
      env: {
        incoming: {
          socket: {
            remoteAddress: "127.0.0.1",
          },
        },
      },
    };
    expect(isLoopbackRequest(mockContext as any)).toBe(true);
  });

  it("rejects non-loopback requests even with X-Matrix-Internal header", () => {
    const mockContext = {
      req: {
        header: (name: string) => (name === "X-Matrix-Internal" ? "true" : "192.168.1.1"),
      },
      env: {
        incoming: {
          socket: {
            remoteAddress: "192.168.1.1",
          },
        },
      },
    };
    expect(isLoopbackRequest(mockContext as any)).toBe(false);
  });
});
