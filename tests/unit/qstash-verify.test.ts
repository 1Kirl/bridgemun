import { describe, expect, it } from "vitest";
import { signQstashForTest, verifyQstashSignature } from "@/server/scheduler/qstashVerify";

const url = "https://bridgemun.example/api/engine/tick";
const body = JSON.stringify({ forumId: "f1", phaseId: "p3", atMs: 1 });
const now = 1_800_000_000;

describe("QStash signature verification", () => {
  it("accepts current or next key; rejects wrong key, url, body, expiry, missing", () => {
    const sig = signQstashForTest("next-key", url, body, now);
    expect(verifyQstashSignature({ signature: sig, body, url, keys: ["current-key", "next-key"], nowSec: now })).toEqual({ ok: true });
    expect(verifyQstashSignature({ signature: sig, body, url, keys: ["other"], nowSec: now })).toMatchObject({ reason: "bad_signature" });
    expect(verifyQstashSignature({ signature: sig, body, url: url + "x", keys: ["next-key"], nowSec: now })).toMatchObject({ reason: "bad_subject" });
    expect(verifyQstashSignature({ signature: sig, body: body + " ", url, keys: ["next-key"], nowSec: now })).toMatchObject({ reason: "body_mismatch" });
    expect(verifyQstashSignature({ signature: sig, body, url, keys: ["next-key"], nowSec: now + 1000 })).toMatchObject({ reason: "expired" });
    expect(verifyQstashSignature({ signature: null, body, url, keys: ["next-key"], nowSec: now })).toMatchObject({ reason: "missing_signature" });
  });
});
