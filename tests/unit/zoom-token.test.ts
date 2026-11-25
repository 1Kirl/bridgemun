import { describe, expect, it } from "vitest";
import { buildZoomTokenPayload, readZoomConfig, zoomSessionName } from "@/server/zoom";

const cfg = { sdkKey: "key", sdkSecret: "secret", sessionSecret: "s".repeat(32) };

describe("zoom token", () => {
  it("is not configured without all three server variables (no legacy NEXT_PUBLIC fallback)", () => {
    expect(readZoomConfig({ ZOOM_VIDEO_SDK_KEY: "a", ZOOM_VIDEO_SDK_SECRET: "b" } as NodeJS.ProcessEnv)).toBeNull();
    expect(
      readZoomConfig({ NEXT_PUBLIC_ZOOM_VIDEO_SDK_KEY: "a", ZOOM_VIDEO_SDK_SECRET: "b", ZOOM_SESSION_SECRET: "c" } as NodeJS.ProcessEnv),
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
