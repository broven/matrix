import { describe, it, expect } from "vitest";
import { generateToken, validateToken, maskToken } from "../auth/token.js";

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
    it("masks a long token", () => {
      const token = "1234567890abcdef1234567890abcdef";
      expect(maskToken(token)).toBe("1234...cdef");
    });

    it("masks a short token completely", () => {
      expect(maskToken("1234567890")).toBe("********");
    });

    it("handles null/undefined", () => {
      expect(maskToken(null)).toBe("null");
      expect(maskToken(undefined)).toBe("undefined");
    });
  });
});
