import { NextResponse, type NextRequest } from "next/server";
import { HttpError, requireUser, withErrors } from "@/server/auth";
import { requireForumMember } from "@/server/forumAccess";
import { buildZoomTokenPayload, readZoomConfig, signZoomToken } from "@/server/zoom";

/**
 * Issues a Zoom Video SDK token only to a signed-in user who already holds a place in the forum.
 * - New joiners after start are blocked upstream (they cannot obtain membership).
 * - Existing members can always renew (refresh / reconnect) until the forum is closed.
 * - Role and session name are decided by the server; client-supplied values are ignored.
 */
export const POST = withErrors(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { forumId?: unknown };
  const forumId = typeof body.forumId === "string" ? body.forumId : "";
  const membership = await requireForumMember(forumId, user.uid);
  if (membership.status === "closed") throw new HttpError(409, "forum_closed");

  const cfg = readZoomConfig();
  if (!cfg) throw new HttpError(503, "zoom_not_configured", "Zoom Video SDK is not configured on the server");

  // Legacy UI: forum creator was the Zoom host. New forums keep the room owner as host only for
  // session management; meeting floor control is done by the server state machine, not by this role.
  const roleType: 0 | 1 = membership.isOwner ? 1 : 0;
  const payload = buildZoomTokenPayload(cfg, {
    forumId,
    uid: user.uid,
    roleType,
    nowSec: Math.floor(Date.now() / 1000),
  });
  return NextResponse.json({ token: signZoomToken(cfg, payload), sessionName: payload.tpc, expiresAt: payload.exp });
});
