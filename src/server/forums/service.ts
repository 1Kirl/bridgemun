import "server-only";
import { randomInt } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { COMMITTEES } from "@/engine/committees";
import { MIN_SEATS } from "@/engine/documents";
import { createForumState, defaultSettingsBase, phaseDeadline } from "@/engine/machine";
import { APP_DEFAULT_POLICIES } from "@/engine/policies";
import { toPublicState } from "@/engine/publicView";
import type { Command, Expectation, ForumEngineState, Seat } from "@/engine/types";
import { HttpError, type AuthedUser } from "@/server/auth";
import { loadState, publicPath, runCommand, statePath, type EffectSink } from "@/server/engine/store";

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const MAX_SEATS = 60;

// ── create ────────────────────────────────────────────────────────

const countryZ = z.object({ code: z.string().regex(/^[a-z]{2}$/), name: z.string().min(1).max(80) });

export const CreateForumInput = z.object({
  title: z.string().trim().min(1).max(120),
  agenda: z.string().trim().min(1).max(300),
  committeeId: z.enum(["DISEC", "SOCHUM", "WHO_HMUN", "ECOFIN", "SPECPOL", "UNSC"]),
  countries: z.array(countryZ).min(MIN_SEATS).max(MAX_SEATS),
  ownerCountry: z.string().regex(/^[a-z]{2}$/),
  durationMin: z.number().int().min(15).max(240),
  speakingTimeSec: z.number().int().min(15).max(180).default(60),
  timers: z
    .object({
      motionWindowSec: z.number().int().min(20).max(180),
      readingSec: z.number().int().min(5).max(60),
      votingSec: z.number().int().min(20).max(180),
      humanPrepSec: z.number().int().min(5).max(60),
      drPresentationSec: z.number().int().min(30).max(300),
      drQaSec: z.number().int().min(30).max(300),
    })
    .partial()
    .default({}),
});
export type CreateForumInput = z.infer<typeof CreateForumInput>;

const JOIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function newJoinCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)];
  return s;
}
export const normaliseCode = (c: string) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function createForum(db: Firestore, user: AuthedUser, raw: unknown) {
  const parsed = CreateForumInput.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid_input", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const input = parsed.data;
  const committee = COMMITTEES.find((c) => c.id === input.committeeId)!;
  if (committee.supportLevel === "planned") throw new HttpError(400, "committee_not_supported", `${committee.name} is not available yet`);
  const codes = input.countries.map((c) => c.code);
  if (new Set(codes).size !== codes.length) throw new HttpError(400, "duplicate_country");
  if (!codes.includes(input.ownerCountry)) throw new HttpError(400, "owner_country_missing", "Choose your own country from the participating countries");

  const forumRef = db.collection("forums").doc();
  const forumId = forumRef.id;
  const base = defaultSettingsBase();
  const seats: Seat[] = input.countries.map((c) => ({
    id: c.code,
    countryName: c.name,
    kind: c.code === input.ownerCountry ? "human" : "ai", // every seat not claimed by a person is an AI delegation
    uid: c.code === input.ownerCountry ? user.uid : undefined,
    attendance: "not_recorded",
    connection: "online",
  }));
  const state = createForumState({
    forumId,
    committeeId: input.committeeId,
    ownerUid: user.uid,
    seats,
    settings: {
      ...base,
      speakingTimeSec: input.speakingTimeSec,
      timers: { ...base.timers, ...input.timers },
      sessionDurationSec: input.durationMin * 60,
      sessionStartMs: 0,
      sessionEndsAtMs: 0,
      policies: APP_DEFAULT_POLICIES,
    },
  });

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newJoinCode();
    try {
      await db.runTransaction(async (tx) => {
        const codeRef = db.doc(`joinCodes/${code}`);
        if ((await tx.get(codeRef)).exists) throw new HttpError(409, "code_collision");
        const now = Date.now();
        tx.set(codeRef, { forumId, createdAtMs: now });
        tx.set(forumRef, {
          kind: "engine",
          title: input.title,
          agenda: input.agenda,
          committeeId: input.committeeId,
          rulesetId: state.rulesetId,
          ownerUid: user.uid,
          joinCode: code,
          status: "lobby",
          seatCount: seats.length,
          durationMin: input.durationMin,
          // Pinned for the life of the forum; later material uploads never change a running forum.
          positionSetVersion: process.env.POSITION_SET_VERSION ?? "none",
          createdAtMs: now,
        });
        tx.set(db.doc(`forums/${forumId}/members/${user.uid}`), {
          uid: user.uid,
          forumId,
          countryCode: input.ownerCountry,
          title: input.title,
          role: "owner",
          joinedAtMs: now,
          lastSeenMs: now,
        });
        tx.set(db.doc(statePath(forumId)), { state: plain(state) });
        tx.set(db.doc(publicPath(forumId)), { state: plain(toPublicState(state)), updatedAtMs: now });
      });
      return { forumId, joinCode: code };
    } catch (e) {
      if (e instanceof HttpError && e.code === "code_collision") continue;
      throw e;
    }
  }
  throw new HttpError(503, "code_generation_failed");
}

// ── join ──────────────────────────────────────────────────────────

export type LobbySeat = { id: string; countryName: string; kind: "human" | "ai"; mine: boolean };

export async function lookupByCode(db: Firestore, user: AuthedUser, rawCode: string) {
  const code = normaliseCode(rawCode ?? "");
  if (code.length !== 6) throw new HttpError(400, "bad_code", "Codes have 6 characters");
  const codeSnap = await db.doc(`joinCodes/${code}`).get();
  if (!codeSnap.exists) throw new HttpError(404, "code_not_found", "No forum uses this code");
  const forumId = codeSnap.data()!.forumId as string;
  const [forumSnap, state, member] = await Promise.all([
    db.doc(`forums/${forumId}`).get(),
    loadState(db, forumId),
    db.doc(`forums/${forumId}/members/${user.uid}`).get(),
  ]);
  if (!forumSnap.exists || !state) throw new HttpError(404, "forum_not_found");
  const f = forumSnap.data()!;
  const isMember = member.exists;
  if (state.joinLocked && !isMember) {
    throw new HttpError(409, "forum_started", "This forum has already started; new participants cannot join");
  }
  const seats: LobbySeat[] = Object.values(state.seats)
    .map((s) => ({ id: s.id, countryName: s.countryName, kind: s.kind, mine: s.uid === user.uid }))
    .sort((a, b) => a.countryName.localeCompare(b.countryName));
  return {
    forumId,
    title: f.title as string,
    agenda: f.agenda as string,
    committeeId: f.committeeId as string,
    status: f.status as string,
    isMember,
    seats,
  };
}

export async function claimSeat(db: Firestore, user: AuthedUser, forumId: string, body: { code?: unknown; seat?: unknown }, sink?: EffectSink) {
  const seatId = typeof body.seat === "string" ? body.seat : "";
  const code = normaliseCode(typeof body.code === "string" ? body.code : "");
  const memberRef = db.doc(`forums/${forumId}/members/${user.uid}`);
  let reconnect: string | null = null;
  const r = await runCommand(
    db,
    forumId,
    { actor: { kind: "human", uid: user.uid }, command: { type: "claim_seat", seat: seatId } },
    {
      onEffects: sink,
      beforeApply: async (tx) => {
        const m = await tx.get(memberRef);
        if (m.exists) {
          // Existing participant: reconnect, never a new join (and never a different country).
          reconnect = m.data()!.countryCode as string;
          return;
        }
        const c = await tx.get(db.doc(`joinCodes/${code}`));
        if (!c.exists || c.data()!.forumId !== forumId) throw new HttpError(403, "bad_code", "A valid join code is required");
      },
      afterApply: (tx, _prev, next) => {
        const now = Date.now();
        tx.set(memberRef, {
          uid: user.uid,
          forumId,
          countryCode: seatId,
          title: null,
          role: next.ownerUid === user.uid ? "owner" : "delegate",
          joinedAtMs: now,
          lastSeenMs: now,
        });
      },
    },
  );
  // Existing participants always get their own seat back, whatever seat they asked for.
  if (reconnect) return { forumId, seat: reconnect as string, reconnect: true };
  if (!r.ok) throw new HttpError(r.code === "seat_taken" || r.code === "join_locked" || r.code === "already_seated" ? 409 : 400, r.code, r.message);
  // Copy the forum title onto the membership row for "My forums" (best effort, outside the transaction).
  const f = await db.doc(`forums/${forumId}`).get();
  await memberRef.set({ title: f.data()?.title ?? null }, { merge: true });
  return { forumId, seat: seatId, reconnect: false };
}

// ── membership guard ─────────────────────────────────────────────

export async function requireMember(db: Firestore, user: AuthedUser, forumId: string) {
  if (!forumId || forumId.includes("/")) throw new HttpError(400, "bad_forum_id");
  const m = await db.doc(`forums/${forumId}/members/${user.uid}`).get();
  if (!m.exists) throw new HttpError(403, "not_a_member", "You have not joined this forum");
  return m.data() as { countryCode: string; role: string };
}

// ── commands ─────────────────────────────────────────────────────

/** Commands a signed-in delegate may send. Server-only commands (tick, connection, transcripts, AI) are excluded. */
const USER_COMMANDS = new Set<Command["type"]>([
  "release_seat",
  "start",
  "declare_attendance",
  "add_to_speakers_list",
  "remove_from_speakers_list",
  "end_speech",
  "submit_text_speech",
  "confirm_transcript",
  "skip_transcript",
  "submit_motion",
  "floor_pass",
  "request_extension",
  "cast_vote",
  "volunteer",
  "caucus_ready",
  "submit_document",
  "update_document",
  "sign_document",
  "submit_amendment",
  "sign_amendment",
  "sponsor_response",
  "submit_division_proposal",
  "raise_point",
  "app_pause",
  "app_resume",
]);

export async function userCommand(
  db: Firestore,
  user: AuthedUser,
  forumId: string,
  body: { command?: unknown; expect?: unknown },
  sink?: EffectSink,
) {
  await requireMember(db, user, forumId);
  const command = body.command as Command | undefined;
  if (!command || typeof command !== "object" || !USER_COMMANDS.has(command.type)) {
    throw new HttpError(400, "command_not_allowed");
  }
  const expect = (body.expect ?? undefined) as Expectation | undefined;
  const memberRef = db.doc(`forums/${forumId}/members/${user.uid}`);
  const r = await runCommand(
    db,
    forumId,
    { actor: { kind: "human", uid: user.uid }, command, expect },
    {
      onEffects: sink,
      afterApply: (tx) => {
        if (command.type === "release_seat") tx.delete(memberRef);
      },
    },
  );
  if (!r.ok) throw new HttpError(r.stale ? 409 : 400, r.code, r.message);
  return { ok: true, duplicate: !!r.duplicate, phaseId: r.state.phaseId };
}

// ── deadlines, presence ─────────────────────────────────────────

/** Delivers the deadline tick if (and only if) the current phase deadline has passed. Safe to call concurrently. */
export async function advanceIfDue(db: Firestore, forumId: string, sink?: EffectSink, now: () => number = Date.now) {
  const s = await loadState(db, forumId);
  if (!s) return { advanced: false, reason: "no_state" };
  const due = s.paused ? s.paused.autoResumeAtMs : phaseDeadline(s.phase);
  if (due === null || now() < due) return { advanced: false, reason: "not_due", phaseId: s.phaseId };
  await sweepPresence(db, forumId, s, sink); // presence uses real heartbeat time (the `now` override only simulates deadlines)
  const r = await runCommand(db, forumId, { actor: { kind: "system" }, command: { type: "tick" }, expect: { phaseId: s.phaseId } }, { onEffects: sink, now });
  return { advanced: r.ok && !r.duplicate, reason: r.ok ? (r.duplicate ? "duplicate" : "advanced") : r.code };
}

export const PRESENCE_TIMEOUT_MS = 60_000;

export async function setPresence(db: Firestore, user: AuthedUser, forumId: string, online: boolean, sink?: EffectSink) {
  const m = await requireMember(db, user, forumId);
  await db.doc(`forums/${forumId}/members/${user.uid}`).set({ lastSeenMs: online ? Date.now() : 0 }, { merge: true });
  const r = await runCommand(db, forumId, { actor: { kind: "system" }, command: { type: "connection", seat: m.countryCode, online } }, { onEffects: sink });
  // Heartbeats of present members also detect members whose tab closed without a beacon.
  const s = await loadState(db, forumId);
  if (s) await sweepPresence(db, forumId, s, sink);
  return { ok: r.ok };
}

/** Marks seats offline whose heartbeat is older than PRESENCE_TIMEOUT_MS (closed tabs that sent no beacon). */
export async function sweepPresence(db: Firestore, forumId: string, s: ForumEngineState, sink?: EffectSink, now: () => number = Date.now) {
  const members = await db.collection(`forums/${forumId}/members`).get();
  for (const d of members.docs) {
    const m = d.data() as { countryCode: string; lastSeenMs?: number };
    const seat = s.seats[m.countryCode];
    if (seat && seat.kind === "human" && seat.connection === "online" && (m.lastSeenMs ?? 0) < now() - PRESENCE_TIMEOUT_MS) {
      await runCommand(db, forumId, { actor: { kind: "system" }, command: { type: "connection", seat: m.countryCode, online: false } }, { onEffects: sink, now });
    }
  }
}

export async function touchMembership(db: Firestore, forumId: string, uid: string) {
  await db.doc(`forums/${forumId}/members/${uid}`).update({ lastSeenMs: Date.now(), heartbeats: FieldValue.increment(1) });
}
