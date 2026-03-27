import { nanoid } from "nanoid";
import { timingSafeEqual } from "node:crypto";

export function generateToken(): string {
  return nanoid(48);
}

export function validateToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return timingSafeEqual(a, b);
}

/**
 * Obfuscates a token for safe logging, keeping only the first and last four characters.
 * Returns "null" or "undefined" if the input is not a string.
 */
export function maskToken(token: string | null | undefined): string {
  if (!token || typeof token !== "string") return String(token);
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
