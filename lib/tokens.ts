import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Account-free identity. A browser proves it is the organiser, or a given participant, with a
 * random token kept in an httpOnly cookie; only the hash is stored.
 */
export const newToken = () => randomBytes(24).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export function tokenMatches(token: string | undefined, hash: string | null | undefined): boolean {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token)), b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const organiserCookie = (groupId: string) => `fm_org_${groupId}`;
export const participantCookie = (groupId: string) => `fm_p_${groupId}`;

export const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 30 * 86400 };
