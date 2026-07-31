// Simple shared-password gate. The cookie stores a SHA-256 digest of the
// password so the plaintext never lives in the browser. Web Crypto only, so it
// runs in both Edge middleware and Node route handlers.

export const AUTH_COOKIE = "rb_auth";

export async function passwordDigest(password: string): Promise<string> {
  const data = new TextEncoder().encode(`rate-beacon:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export async function isAuthorized(cookieValue: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!cookieValue) return false;
  const expected = await passwordDigest(process.env.APP_PASSWORD!);
  return cookieValue === expected;
}
