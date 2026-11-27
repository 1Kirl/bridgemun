import "server-only";
import { OAuth2Client } from "google-auth-library";

/**
 * Verifies the Google-signed OIDC token that Cloud Tasks / Cloud Scheduler attach to their requests:
 * signature (Google certificates), expiry, issuer, audience = this exact URL, and that the identity is the one
 * allowed service account (verified e-mail). Request headers such as X-CloudTasks-* are never trusted on their own.
 */
export type OidcCheck = { ok: true } | { ok: false; reason: string };
export type IdTokenVerifier = (idToken: string, audience: string) => Promise<{ iss?: string; email?: string; email_verified?: boolean } | undefined>;

const client = new OAuth2Client();
const googleVerifier: IdTokenVerifier = async (idToken, audience) => (await client.verifyIdToken({ idToken, audience })).getPayload();

export async function verifyServiceOidc(
  authorization: string | null,
  audience: string,
  allowedEmail: string,
  verify: IdTokenVerifier = googleVerifier,
): Promise<OidcCheck> {
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(authorization ?? "");
  if (!m) return { ok: false, reason: "missing_bearer_token" };
  let p: Awaited<ReturnType<IdTokenVerifier>>;
  try {
    p = await verify(m[1], audience);
  } catch {
    return { ok: false, reason: "invalid_token" }; // bad signature, expired, wrong audience, malformed
  }
  if (!p) return { ok: false, reason: "invalid_token" };
  if (p.iss !== "https://accounts.google.com" && p.iss !== "accounts.google.com") return { ok: false, reason: "wrong_issuer" };
  if (!allowedEmail || p.email !== allowedEmail || p.email_verified !== true) return { ok: false, reason: "wrong_identity" };
  return { ok: true };
}
