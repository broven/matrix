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
 * Masks a token for safe logging (e.g., "abcd...wxyz")
 */
export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
