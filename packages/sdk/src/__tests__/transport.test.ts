import { describe, it, expect } from "vitest";
import { createTransport } from "../transport/index.js";

describe("transport", () => {
  it("creates a websocket transport by default", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test-token",
      mode: "websocket",
    });
    expect(transport).toBeDefined();
    expect(transport.type).toBe("websocket");
  });

  it("creates an sse transport", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test-token",
      mode: "sse",
    });
    expect(transport.type).toBe("sse");
  });

  it("creates a polling transport", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test-token",
      mode: "polling",
    });
    expect(transport.type).toBe("polling");
  });

  it("auto defaults to websocket", () => {
    const transport = createTransport({
      serverUrl: "http://localhost:8080",
      token: "test-token",
      mode: "auto",
    });
    expect(transport.type).toBe("websocket");
  });
});
