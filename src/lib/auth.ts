/**
 * Admin authentication. A single admin is gated by a password (entered in the
 * admin modal). On success we set a signed, HMAC-protected, httpOnly cookie.
 *
 * Password source of truth: ADMIN_PASSWORD_HASH (bcrypt) if present, otherwise
 * ADMIN_PASSWORD is compared directly (dev convenience). Cookie integrity is
 * protected with an HMAC over a timestamp using SESSION_SECRET.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { env } from "@/lib/env";
import { Errors } from "@/lib/errors";

const COOKIE_NAME = "chb_admin";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12h

// Mark the cookie Secure only when the site is actually served over HTTPS
// (reflected by APP_URL). Basing this on NODE_ENV breaks E2E tests that run a
// production build over http://localhost, where a Secure cookie is never stored.
const COOKIE_SECURE = env.APP_URL.startsWith("https://");

function sign(payload: string): string {
  const mac = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

function verify(token: string): boolean {
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = createHmac("sha256", env.SESSION_SECRET)
    .update(payload)
    .digest("hex");
  try {
    if (
      mac.length !== expected.length ||
      !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
    ) {
      return false;
    }
  } catch {
    return false;
  }
  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt < MAX_AGE_SECONDS * 1000;
}

/** Validate a plaintext password against configured credentials. */
export async function checkPassword(password: string): Promise<boolean> {
  if (env.ADMIN_PASSWORD_HASH) {
    return bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
  }
  if (env.ADMIN_PASSWORD) {
    // Compare sha256 digests so the check is constant-time regardless of
    // input length (timingSafeEqual requires equal-length buffers).
    const a = createHash("sha256").update(password).digest();
    const b = createHash("sha256").update(env.ADMIN_PASSWORD).digest();
    return timingSafeEqual(a, b);
  }
  return false;
}

/** Issue the admin session cookie. */
export async function createSession(): Promise<void> {
  const token = sign(String(Date.now()));
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verify(token) : false;
}

/** Throw 401 unless the current request carries a valid admin session. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw Errors.unauthorized("Admin session required");
}
