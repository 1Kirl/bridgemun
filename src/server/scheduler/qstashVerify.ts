import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies an Upstash QStash delivery: `Upstash-Signature` is a JWT (HS256) signed with the current or
 * next signing key; claims: iss="Upstash", sub=destination URL, exp/nbf, body=base64url(sha256(body)).
 * Pure and unit-tested; not yet exercised against a real QStash account.
 */
const b64url = (b: Buffer) => b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export type VerifyInput = { signature: string | null; body: string; url: string; keys: string[]; nowSec?: number };

export function verifyQstashSignature(i: VerifyInput): { ok: true } | { ok: false; reason: string } {
  if (!i.signature) return { ok: false, reason: "missing_signature" };
  const parts = i.signature.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [h, p, sig] = parts;
  const keys = i.keys.filter(Boolean);
  if (!keys.length) return { ok: false, reason: "no_keys" };
  const valid = keys.some((k) => {
    const expected = createHmac("sha256", k).update(`${h}.${p}`).digest();
    const got = fromB64url(sig);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!valid) return { ok: false, reason: "bad_signature" };
  let claims: { iss?: string; sub?: string; exp?: number; nbf?: number; body?: string };
  try {
    const header = JSON.parse(fromB64url(h).toString("utf8")) as { alg?: string };
    if (header.alg !== "HS256") return { ok: false, reason: "bad_alg" };
    claims = JSON.parse(fromB64url(p).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const now = i.nowSec ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== "Upstash") return { ok: false, reason: "bad_issuer" };
  if (claims.sub !== i.url) return { ok: false, reason: "bad_subject" };
  if (typeof claims.exp === "number" && now > claims.exp) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && now + 5 < claims.nbf) return { ok: false, reason: "not_yet_valid" };
  const bodyHash = b64url(createHash("sha256").update(i.body).digest());
  if ((claims.body ?? "").replace(/=+$/, "") !== bodyHash) return { ok: false, reason: "body_mismatch" };
  return { ok: true };
}

/** Test helper: produces a signature the way QStash does. */
export function signQstashForTest(key: string, url: string, body: string, nowSec: number) {
  const enc = (o: unknown) => b64url(Buffer.from(JSON.stringify(o)));
  const h = enc({ alg: "HS256", typ: "JWT" });
  const p = enc({ iss: "Upstash", sub: url, exp: nowSec + 300, nbf: nowSec, iat: nowSec, body: b64url(createHash("sha256").update(body).digest()) });
  const s = b64url(createHmac("sha256", key).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
}
