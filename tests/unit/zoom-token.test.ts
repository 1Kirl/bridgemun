import { describe, expect, it } from "vitest";
import { buildZoomTokenPayload, readZoomConfig, zoomSessionName } from "@/server/zoom";

const cfg = { sdkKey: "key", sdkSecret: "secret", sessionSecret: "s".repeat(32) };

describe("zoom token", () => {
  it("is not configured without all three server variables (no legacy NEXT_PUBLIC fallback)", () => {
    expect(readZoomConfig({ ZOOM_VIDEO_SDK_KEY: "a", ZOOM_VIDEO_SDK_SECRET: "b" })).toBeNull();
    expect(
      readZoomConfig({ NEXT_PUBLIC_ZOOM_VIDEO_SDK_KEY: "a", ZOOM_VIDEO_SDK_SECRET: "b", ZOOM_SESSION_SECRET: "c" }),
    ).toBeNull();
  });
  it("session name is derived from forum id + secret, not equal to the forum id", () => {
    const a = zoomSessionName("forumA", cfg.sessionSecret);
    expect(a).not.toContain("forumA");
    expect(a).toBe(zoomSessionName("forumA", cfg.sessionSecret));
    expect(a).not.toBe(zoomSessionName("forumB", cfg.sessionSecret));
    expect(a).not.toBe(zoomSessionName("forumA", "other-secret-other-secret-other-secret"));
  });
  it("payload uses server-decided role and uid identity", () => {
    const p = buildZoomTokenPayload(cfg, { forumId: "f", uid: "u1", roleType: 0, nowSec: 1000 });
    expect(p.role_type).toBe(0);
    expect(p.user_identity).toBe("u1");
    expect(p.exp - p.iat).toBe(7200);
  });
});

import { KJUR } from "jsrsasign";
import { signZoomToken } from "@/server/zoom";

describe("zoom JWT (Video SDK format)", () => {
  it("is a valid HS256 JWT verifiable with the SDK secret, with Video SDK claims", () => {
    const p = buildZoomTokenPayload(cfg, { forumId: "f", uid: "u1", roleType: 1, nowSec: 1_800_000_000 });
    const jwt = signZoomToken(cfg, p);
    expect(KJUR.jws.JWS.verify(jwt, { utf8: cfg.sdkSecret } as unknown as string, ["HS256"])).toBe(true);
    expect(KJUR.jws.JWS.verify(jwt, { utf8: "wrong-secret" } as unknown as string, ["HS256"])).toBe(false);
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    expect(claims).toMatchObject({ app_key: "key", role_type: 1, version: 1, user_identity: "u1" });
    expect(claims.tpc).toMatch(/^bm-[0-9a-f]{40}$/);
  });
});
