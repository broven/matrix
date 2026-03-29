import { describe, it, expect } from "vitest";
import { generateToken, validateToken } from "../auth/token.js";

describe("auth/token", () => {
  it("generates a token string", () => {
    const token = generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });

  it("validates a correct token", () => {
    const token = generateToken();
    expect(validateToken(token, token)).toBe(true);
  });

  it("rejects an incorrect token", () => {
    const token = generateToken();
    expect(validateToken("wrong-token", token)).toBe(false);
  });

  describe("maskToken", () => {
    it("masks a long token", async () => {
      const { maskToken } = await import("../auth/token.js");
      const token = "1234567890abcdef";
      expect(maskToken(token)).toBe("1234...cdef");
    });

    it("masks a short token completely", async () => {
      const { maskToken } = await import("../auth/token.js");
      expect(maskToken("12345678")).toBe("****");
    });

    it("handles null/undefined", async () => {
      const { maskToken } = await import("../auth/token.js");
      expect(maskToken(null)).toBe("none");
      expect(maskToken(undefined)).toBe("none");
    });
  });
});
