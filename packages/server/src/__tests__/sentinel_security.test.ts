import { describe, it, expect } from "bun:test";
import { maskToken } from "../auth/token.js";

describe("maskToken", () => {
  it("masks a long token", () => {
    expect(maskToken("1234567890abcdef1234567890abcdef1234567890abcdef")).toBe("1234...cdef");
  });

  it("masks a short token", () => {
    expect(maskToken("12345678")).toBe("****");
  });

  it("masks a very short token", () => {
    expect(maskToken("abc")).toBe("****");
  });
});
