import "server-only";
import { adminDb } from "@/server/firebaseAdmin";
import { HttpError } from "@/server/auth";

export type ForumMembership = {
  forumId: string;
  uid: string;
  status: string;
  isOwner: boolean;
  countryCode: string;
};

/**
 * Confirms that `uid` already holds a seat (forums/{id}/members/{uid}, written only by the server
 * in the same transaction as the seat assignment). Membership — not the forum phase — is what allows
 * refresh / reconnect / media-token renewal after start; new joiners cannot become members once started.
 */
export async function requireForumMember(forumId: string, uid: string): Promise<ForumMembership> {
  if (!forumId || typeof forumId !== "string" || forumId.includes("/")) {
    throw new HttpError(400, "bad_forum_id");
  }
  const db = adminDb();
  const [forumSnap, memberSnap] = await Promise.all([
    db.doc(`forums/${forumId}`).get(),
    db.doc(`forums/${forumId}/members/${uid}`).get(),
  ]);
  if (!forumSnap.exists) throw new HttpError(404, "forum_not_found");
  if (!memberSnap.exists) throw new HttpError(403, "not_a_member", "You have not joined this forum");
  const forum = forumSnap.data() as { status?: string; ownerUid?: string };
  const m = memberSnap.data() as { countryCode: string };
  return {
    forumId,
    uid,
    status: forum.status ?? "unknown",
    isOwner: forum.ownerUid === uid,
    countryCode: m.countryCode,
  };
}
