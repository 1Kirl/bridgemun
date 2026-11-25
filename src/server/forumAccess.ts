import "server-only";
import { adminDb } from "@/server/firebaseAdmin";
import { HttpError } from "@/server/auth";

export type ForumMembership = {
  forumId: string;
  uid: string;
  status: string;
  /** Legacy (pre-Phase 2) forums: creator acted as moderator. New forums: room owner only. */
  isOwner: boolean;
  countryCode: string | null;
  source: "members" | "legacy-participants" | "owner";
};

/**
 * Confirms that `uid` already holds a place in the forum.
 * New forums (Phase 2+) record membership in forums/{id}/members/{uid};
 * forums created by the legacy UI only have the participants sub-collection.
 * Being a member is what allows refresh / reconnect / media-token renewal after start.
 */
export async function requireForumMember(forumId: string, uid: string): Promise<ForumMembership> {
  if (!forumId || typeof forumId !== "string" || forumId.includes("/")) {
    throw new HttpError(400, "bad_forum_id");
  }
  const db = adminDb();
  const forumSnap = await db.doc(`forums/${forumId}`).get();
  if (!forumSnap.exists) throw new HttpError(404, "forum_not_found");
  const forum = forumSnap.data() as { status?: string; createdBy?: string; ownerUid?: string };
  const status = forum.status ?? "unknown";
  const ownerUid = forum.ownerUid ?? forum.createdBy ?? null;

  const memberSnap = await db.doc(`forums/${forumId}/members/${uid}`).get();
  if (memberSnap.exists) {
    const m = memberSnap.data() as { countryCode?: string };
    return { forumId, uid, status, isOwner: ownerUid === uid, countryCode: m.countryCode ?? null, source: "members" };
  }
  const legacy = await db.collection(`forums/${forumId}/participants`).where("userId", "==", uid).limit(1).get();
  if (!legacy.empty) {
    const p = legacy.docs[0].data() as { country?: { code?: string } };
    return {
      forumId,
      uid,
      status,
      isOwner: ownerUid === uid,
      countryCode: p.country?.code ?? null,
      source: "legacy-participants",
    };
  }
  if (ownerUid === uid) {
    return { forumId, uid, status, isOwner: true, countryCode: null, source: "owner" };
  }
  throw new HttpError(403, "not_a_member", "You have not joined this forum");
}
