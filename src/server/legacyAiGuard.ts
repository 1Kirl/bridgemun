import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { HttpError, requireUser } from "@/server/auth";
import { requireForumMember } from "@/server/forumAccess";
import { adminDb } from "@/server/firebaseAdmin";

/**
 * Guard for the previous developer's Gemini routes, kept only until Phase 5 replaces them
 * with the server-side OpenAI orchestrator.
 * - signed-in forum owner only (these were moderator buttons in the legacy UI)
 * - disabled unless GEMINI_API_KEY is configured in the NEW environment (no legacy key fallback)
 * - hard per-forum call cap so an exposed route cannot run up cost
 */
export async function guardLegacyAi(req: NextRequest, forumId: unknown): Promise<{ apiKey: string }> {
  const user = await requireUser(req);
  const id = typeof forumId === "string" ? forumId : "";
  const m = await requireForumMember(id, user.uid);
  if (!m.isOwner) throw new HttpError(403, "owner_only");

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, "legacy_ai_disabled", "Legacy Gemini AI is disabled in this environment");

  const cap = Number(process.env.LEGACY_AI_MAX_CALLS_PER_FORUM ?? "40");
  const ref = adminDb().doc(`forums/${id}/usage/legacyAi`);
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = (snap.data()?.calls as number | undefined) ?? 0;
    if (used >= cap) throw new HttpError(429, "ai_quota_exceeded");
    tx.set(ref, { calls: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { apiKey };
}
