import { createHmac } from "node:crypto";
import { KJUR } from "jsrsasign";

export type ZoomServerConfig = { sdkKey: string; sdkSecret: string; sessionSecret: string };

export function readZoomConfig(env: NodeJS.ProcessEnv = process.env): ZoomServerConfig | null {
  const sdkKey = env.ZOOM_VIDEO_SDK_KEY?.trim();
  const sdkSecret = env.ZOOM_VIDEO_SDK_SECRET?.trim();
  const sessionSecret = env.ZOOM_SESSION_SECRET?.trim();
  if (!sdkKey || !sdkSecret || !sessionSecret) return null;
  return { sdkKey, sdkSecret, sessionSecret };
}

/** Non-guessable, stable per forum: knowing a forum id is not enough to join its media session. */
export function zoomSessionName(forumId: string, sessionSecret: string): string {
  const digest = createHmac("sha256", sessionSecret).update(`forum:${forumId}`).digest("hex");
  return `bm-${digest.slice(0, 40)}`;
}

export type ZoomTokenInput = {
  forumId: string;
  uid: string;
  /** Decided by the server, never taken from the client. */
  roleType: 0 | 1;
  nowSec: number;
  ttlSec?: number;
};

export function buildZoomTokenPayload(cfg: ZoomServerConfig, input: ZoomTokenInput) {
  const iat = input.nowSec - 30;
  const exp = iat + (input.ttlSec ?? 60 * 60 * 2);
  return {
    app_key: cfg.sdkKey,
    tpc: zoomSessionName(input.forumId, cfg.sessionSecret),
    role_type: input.roleType,
    user_identity: input.uid,
    version: 1,
    iat,
    exp,
  };
}

export function signZoomToken(cfg: ZoomServerConfig, payload: ReturnType<typeof buildZoomTokenPayload>): string {
  return KJUR.jws.JWS.sign(
    "HS256",
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    JSON.stringify(payload),
    cfg.sdkSecret,
  );
}
