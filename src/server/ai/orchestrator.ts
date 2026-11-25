import "server-only";
import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { stableHash } from "@/engine/documents";
import { toPublicState, type PublicForumState } from "@/engine/publicView";
import { allowedChoices } from "@/engine/voting";
import type { Effect, ForumEngineState, MotionParams, RecordEntry } from "@/engine/types";
import { loadState, runCommand, type EffectSink } from "@/server/engine/store";
import { loadPositionSet, retrieve, type Retrieval } from "@/server/positions/positions";
import type { AudioStore } from "@/server/speech/audioStore";
import type { TtsProvider } from "@/server/speech/providers";
import { assignVoices } from "@/server/speech/voices";
import { BudgetExceeded, reserve, settle, type Caps } from "@/server/usage/budget";
import type { LlmProvider, LlmRequest } from "@/server/ai/llm";
import {
  evidenceBlock,
  FLOOR_SCHEMA,
  motionText,
  recordBlock,
  situation,
  SPEECH_SCHEMA,
  SYSTEM_PROMPT,
  sponsorSchemaFor,
  votesSchemaFor,
  type ForumContext,
} from "@/server/ai/prompts";

/**
 * Server-side AI orchestration (Phase 5). One flow per forum, driven by engine effects — never by
 * client tabs. AI delegations act only through the same engine commands as humans.
 *
 * Staleness: every action carries what it reasoned over —
 *   speech → contextSeq (rejected if any statement was confirmed meanwhile; regenerated once)
 *   vote   → ballotId (+ textHash for documents); other seats' votes never invalidate it
 *   floor  → windowId (phaseId)
 * Idempotency: per-action job keys (seat + phase/ballot/context) prevent duplicate work in-process;
 * the engine's natural keys prevent duplicate effects even across restarts.
 * Cost: budget reserved before every external call; on BudgetExceeded the call is skipped.
 */
export type OrchestratorConfig = {
  llm: LlmProvider;
  tts: TtsProvider | null;
  audioStore: AudioStore | null;
  caps: Caps;
  models: { decision: string; speech: string };
  ttsModelId: string;
  /** Max AI delegations consulted per floor window (others pass) — app limit against monopolising. */
  floorConsultPerWindow: number;
  /** Seconds after which an AI seat may speak again via the floor (app limit). */
  aiCooldownSec: number;
  delayMs: number;
  /** Registers background work so the request can await it after responding (serverless). */
  track?: (p: Promise<unknown>) => void;
};

const FloorZ = z.object({
  action: z.enum(["pass", "request_floor", "move_motion"]),
  motion: z
    .object({ type: z.enum(["mod_caucus", "unmod_caucus", "set_speaking_time"]), topic: z.string(), speakingSec: z.number().int(), totalSec: z.number().int() })
    .nullable(),
  rationale: z.string().max(2000),
  evidenceIds: z.array(z.string()).max(10),
});
const VotesZ = z.object({
  votes: z.array(z.object({ seat: z.string(), choice: z.enum(["yes", "no", "abstain"]), rationale: z.string().max(2000), evidenceIds: z.array(z.string()).max(10) })),
});
const SpeechZ = z.object({ text: z.string().min(1).max(4000), rationale: z.string().max(2000), evidenceIds: z.array(z.string()).max(10) });
const SponsorZ = z.object({ responses: z.array(z.object({ seat: z.string(), agree: z.boolean(), rationale: z.string().max(2000) })) });

const parseWith = <T,>(schema: z.ZodType<T>) => (x: unknown) => {
  const r = schema.safeParse(x);
  return r.success ? r.data : null;
};

export function createAiOrchestrator(db: Firestore, cfg: OrchestratorConfig, getSink: () => EffectSink) {
  const queues = new Map<string, Promise<unknown>>();
  const jobs = new Set<string>();
  const enqueue = (forumId: string, key: string, fn: () => Promise<unknown>) => {
    if (jobs.has(key)) return; // duplicate effect delivery
    jobs.add(key);
    const run = () =>
      fn()
        .catch((e) => console.error("[ai]", key, e))
        .finally(() => setTimeout(() => jobs.delete(key), 10 * 60_000));
    const done = new Promise<void>((resolve) =>
      setTimeout(() => {
        const prev = queues.get(forumId) ?? Promise.resolve();
        const next = prev.then(run);
        queues.set(forumId, next);
        void next.then(() => resolve());
      }, cfg.delayMs),
    );
    // Tracked so serverless handlers can keep the function alive until the work finishes (after()).
    cfg.track?.(done);
  };

  const act = (forumId: string, seat: string, command: Parameters<typeof runCommand>[2]["command"], expect?: Parameters<typeof runCommand>[2]["expect"]) =>
    runCommand(db, forumId, { actor: { kind: "ai", seat }, command, expect }, { onEffects: getSink() });

  async function load(forumId: string) {
    const [state, forum, rec] = await Promise.all([
      loadState(db, forumId),
      db.doc(`forums/${forumId}`).get(),
      db.collection(`forums/${forumId}/record`).orderBy("seq", "desc").limit(20).get(),
    ]);
    if (!state || !forum.exists) return null;
    const f = forum.data()!;
    const set = loadPositionSet(f.positionSetVersion as string | undefined);
    const ctx: ForumContext = {
      forumId,
      title: f.title,
      agenda: f.agenda,
      committeeId: f.committeeId,
      positionSetVersion: (f.positionSetVersion as string) ?? "none",
      positionSetKind: set ? set.kind : "none",
    };
    return { state, pub: toPublicState(state), ctx, set, record: rec.docs.map((d) => d.data() as RecordEntry).reverse() };
  }

  /** Stop spending when nobody is listening, the forum is paused or closed. */
  function shouldAct(s: ForumEngineState) {
    if (s.phase.type === "CLOSED" || s.paused) return false;
    return Object.values(s.seats).some((x) => x.kind === "human" && x.connection === "online");
  }

  async function callLlm<T>(forumId: string, req: LlmRequest<T>) {
    const estimate = 1500 + req.maxOutputTokens;
    try {
      await reserve(db, forumId, { llm_calls: 1, llm_tokens: estimate }, cfg.caps);
    } catch (e) {
      if (e instanceof BudgetExceeded) return { ok: false as const, error: e.message };
      throw e;
    }
    let r = await cfg.llm.generate(req);
    if (!r.ok && r.error === "validation_failed") {
      // one limited retry, also budgeted
      try {
        await reserve(db, forumId, { llm_calls: 1, llm_tokens: estimate }, cfg.caps);
        r = await cfg.llm.generate(req);
      } catch (e) {
        if (!(e instanceof BudgetExceeded)) throw e;
      }
    }
    const used = (r.usage?.input ?? 0) + (r.usage?.output ?? 0);
    if (used) await settle(db, forumId, { llm_tokens: used - estimate });
    return r;
  }

  async function logAction(forumId: string, entry: Record<string, unknown>) {
    await db.collection(`forums/${forumId}/aiActions`).add({ ...entry, provider: cfg.llm.name, atMs: Date.now() });
  }

  const retr = (L: NonNullable<Awaited<ReturnType<typeof load>>>, seat: string, query: string): Retrieval => retrieve(L.set, seat, L.ctx.agenda, query);

  // ── floor window ────────────────────────────────────────────────
  async function onFloor(forumId: string, windowId: string) {
    const L = await load(forumId);
    if (!L || !shouldAct(L.state) || L.state.phase.type !== "FLOOR_OPEN" || L.state.phase.windowId !== windowId) return;
    const ai = Object.values(L.state.seats).filter((x) => x.kind === "ai" && x.attendance !== "not_recorded").map((x) => x.id);
    const lastSpoke = new Map<string, number>();
    for (const r of L.record) if (r.seat && r.source === "ai_speech") lastSpoke.set(r.seat, r.atMs);
    const eligible = ai
      .filter((id) => !L.state.speakersList.includes(id))
      .filter((id) => Date.now() - (lastSpoke.get(id) ?? 0) > cfg.aiCooldownSec * 1000);
    const start = parseInt(stableHash(windowId).slice(0, 8), 16);
    const consult = eligible.map((_, i) => eligible[(start + i) % eligible.length]).slice(0, cfg.floorConsultPerWindow);
    for (const seat of consult) {
      const fresh = await loadState(db, forumId);
      if (!fresh || fresh.phase.type !== "FLOOR_OPEN" || fresh.phase.windowId !== windowId) return; // window moved on
      const ev = retr(L, seat, `${L.ctx.agenda} ${L.record.slice(-3).map((r) => r.text).join(" ")}`);
      const r = await callLlm(forumId, {
        model: cfg.models.decision,
        schemaName: "floor_decision",
        schema: FLOOR_SCHEMA,
        maxOutputTokens: 400,
        validate: parseWith(FloorZ),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              situation(L.ctx, L.pub, seat),
              evidenceBlock(ev),
              recordBlock(L.record, L.pub),
              `THE FLOOR IS OPEN. Choose ONE: "pass"; "request_floor" (join the speakers' list to make a statement); or "move_motion" with a moderated caucus (topic, speakingSec 30-90, totalSec 180-600), unmoderated caucus (totalSec 180-600) or set_speaking_time (speakingSec 30-120). Prefer pass unless it clearly serves your country's goals. Motions are procedural.`,
            ].join("\n\n"),
          },
        ],
      });
      if (!r.ok) {
        await logAction(forumId, { seat, kind: "floor", windowId, ok: false, error: r.error });
        continue;
      }
      const d = r.data;
      if (d.action === "request_floor") await act(forumId, seat, { type: "add_to_speakers_list", seat });
      if (d.action === "move_motion" && d.motion) {
        const p: MotionParams =
          d.motion.type === "mod_caucus"
            ? { type: "mod_caucus", topic: d.motion.topic.slice(0, 120) || "Key concerns", speakingSec: d.motion.speakingSec, totalSec: d.motion.totalSec }
            : d.motion.type === "unmod_caucus"
              ? { type: "unmod_caucus", totalSec: d.motion.totalSec }
              : { type: "set_speaking_time", speakingSec: d.motion.speakingSec };
        const res = await act(forumId, seat, { type: "submit_motion", seat, params: p }, { phaseId: windowId });
        if (!res.ok) await logAction(forumId, { seat, kind: "floor", windowId, ok: false, error: `engine_rejected:${res.code}` });
      }
      await logAction(forumId, { seat, kind: "floor", windowId, ok: true, action: d.action, summary: d.rationale.slice(0, 400), evidence: d.evidenceIds, matchLevel: ev.matchLevel, model: r.model });
    }
    const s = await loadState(db, forumId);
    if (!s || s.phase.type !== "FLOOR_OPEN" || s.phase.windowId !== windowId) return;
    for (const seat of ai) await act(forumId, seat, { type: "floor_pass", seat }, { phaseId: windowId });
  }

  // ── votes (one batched decision per ballot, each seat judged on its own materials) ──
  async function onVote(forumId: string, ballotId: string, seats: string[]) {
    const L = await load(forumId);
    if (!L) return;
    const b = L.state.ballots[ballotId];
    if (!b || b.status !== "open" || !shouldAct(L.state)) return;
    const subject =
      b.subject.type === "motion"
        ? `PROCEDURAL VOTE on motion: ${motionText(L.pub, b.subject.motionId)}. Choices: yes/no. Consider which issues you want debated, remaining time and negotiation strategy.`
        : b.subject.type === "resolution"
          ? `SUBSTANTIVE VOTE on resolution ${b.subject.docId} v${b.subject.version}:\n${docText(L.state, b.subject.docId)}\nJudge each operative clause against your position materials.`
          : `SUBSTANTIVE VOTE (2/3) on amendment ${b.subject.amendmentId}: ${JSON.stringify(L.state.amendments[b.subject.amendmentId]?.op)}`;
    const blocks = seats.map((seat) => {
      const ev = retr(L, seat, subject);
      return { seat, ev, text: `--- seat "${seat}" = ${L.pub.seats[seat]?.countryName}; allowed: ${allowedChoices(b, seat).join("/")}\n${evidenceBlock(ev)}` };
    });
    const r = await callLlm(forumId, {
      model: cfg.models.decision,
      schemaName: "ballot_votes",
      schema: votesSchemaFor(seats),
      maxOutputTokens: 300 + 120 * seats.length,
      validate: parseWith(VotesZ),
      messages: [
        { role: "system", content: SYSTEM_PROMPT + "\nHere you decide separately for EACH listed AI delegation; each must follow ITS OWN materials. Do not make delegations agree for the sake of agreement." },
        { role: "user", content: [`COMMITTEE: ${L.ctx.committeeId} — AGENDA: ${L.ctx.agenda}`, subject, recordBlock(L.record, L.pub, 8), ...blocks.map((x) => x.text)].join("\n\n") },
      ],
    });
    if (!r.ok) {
      await logAction(forumId, { kind: "vote", ballotId, ok: false, error: r.error, seats });
      return; // AI seats remain "did not vote" — never a fabricated vote
    }
    const textHash = "textHash" in b.subject ? b.subject.textHash : undefined;
    for (const v of r.data.votes) {
      if (!seats.includes(v.seat)) continue; // never vote for seats not asked (incl. humans)
      const allowed = allowedChoices(b, v.seat);
      if (!allowed.includes(v.choice)) {
        await logAction(forumId, { seat: v.seat, kind: "vote", ballotId, ok: false, error: `choice_not_allowed:${v.choice}` });
        continue;
      }
      const res = await act(forumId, v.seat, { type: "cast_vote", seat: v.seat, ballotId, choice: v.choice }, { ballotId, textHash });
      const ev = blocks.find((x) => x.seat === v.seat)!.ev;
      await logAction(forumId, {
        seat: v.seat,
        kind: "vote",
        ballotId,
        ok: res.ok,
        choice: v.choice,
        summary: v.rationale.slice(0, 400),
        evidence: v.evidenceIds.filter((id) => ev.chunks.some((c) => c.id === id)),
        matchLevel: ev.matchLevel,
        model: r.model,
        ...(res.ok ? {} : { error: res.code }),
      });
    }
  }

  // ── speech ─────────────────────────────────────────────────────
  async function onSpeech(forumId: string, seat: string, contextSeq: number, maxWords: number, attempt = 0): Promise<void> {
    const L = await load(forumId);
    if (!L || !shouldAct(L.state)) return;
    const p = L.state.phase;
    if (p.type !== "AI_SPEECH_PENDING" || p.seat !== seat) return;
    const ctxSeq = L.state.contextSeq; // always reason over the CURRENT confirmed record
    const ev = retr(L, seat, `${L.ctx.agenda} ${L.record.slice(-4).map((r) => r.text).join(" ")}`);
    const topic = p.context.kind === "mod_caucus" ? `Moderated caucus topic: ${L.state.activeCaucus?.topic ?? ""}.` : "Formal debate (speakers' list).";
    const r = await callLlm(forumId, {
      model: cfg.models.speech,
      schemaName: "delegate_speech",
      schema: SPEECH_SCHEMA,
      maxOutputTokens: Math.min(900, maxWords * 3 + 200),
      validate: parseWith(SpeechZ),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [situation(L.ctx, L.pub, seat), evidenceBlock(ev), recordBlock(L.record, L.pub), `${topic} Deliver your statement now: at most ${maxWords} words, formal, respond to the latest confirmed statements where relevant.`].join("\n\n"),
        },
      ],
    });
    if (!r.ok) {
      await logAction(forumId, { seat, kind: "speech", contextSeq: ctxSeq, ok: false, error: r.error });
      return; // engine times out → "AI speech unavailable" in the record
    }
    const text = r.data.text.split(/\s+/).slice(0, maxWords).join(" ");
    let audioId: string | undefined;
    let durationMs: number | undefined;
    if (cfg.tts && cfg.audioStore) {
      const voices = assignVoices(forumId, Object.values(L.state.seats).filter((x) => x.kind === "ai").map((x) => x.id));
      try {
        await reserve(db, forumId, { tts_chars: text.length }, cfg.caps);
        const t = await cfg.tts.synthesize({ text, voiceId: voices[seat].voiceId, modelId: cfg.ttsModelId });
        if (t.ok) {
          audioId = `a${randomUUID().replace(/-/g, "").slice(0, 20)}`;
          await cfg.audioStore.put(forumId, audioId, t.audio, t.mime);
          durationMs = t.durationMs;
        } else await logAction(forumId, { seat, kind: "tts", ok: false, error: t.error });
      } catch (e) {
        if (!(e instanceof BudgetExceeded)) throw e;
        await logAction(forumId, { seat, kind: "tts", ok: false, error: e.message }); // captions only
      }
    }
    const res = await act(forumId, seat, { type: "ai_speech_ready", seat, text, contextSeq: ctxSeq, audioId, durationMs });
    await logAction(forumId, { seat, kind: "speech", contextSeq: ctxSeq, ok: res.ok, summary: r.data.rationale.slice(0, 400), evidence: r.data.evidenceIds.filter((id) => ev.chunks.some((c) => c.id === id)), matchLevel: ev.matchLevel, audioId: audioId ?? null, model: r.model, ...(res.ok ? {} : { error: res.code }) });
    if (!res.ok && res.code === "stale_context" && attempt === 0) return onSpeech(forumId, seat, contextSeq, maxWords, 1); // regenerate once on new context
  }

  async function onSponsor(forumId: string, amendmentId: string, seats: string[]) {
    const L = await load(forumId);
    if (!L || !shouldAct(L.state)) return;
    const a = L.state.amendments[amendmentId];
    if (!a || L.state.phase.type !== "AMENDMENT_SPONSOR_RESPONSE") return;
    const r = await callLlm(forumId, {
      model: cfg.models.decision,
      schemaName: "sponsor_responses",
      schema: sponsorSchemaFor(seats),
      maxOutputTokens: 120 + 100 * seats.length,
      validate: parseWith(SponsorZ),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `You sponsor resolution ${a.targetDocId}:\n${docText(L.state, a.targetDocId)}`,
            `Proposed amendment: ${JSON.stringify(a.op)}. Agreeing makes it friendly (adopted immediately).`,
            ...seats.map((seat) => `--- ${L.pub.seats[seat]?.countryName} (${seat})\n${evidenceBlock(retr(L, seat, JSON.stringify(a.op)))}`),
          ].join("\n\n"),
        },
      ],
    });
    if (!r.ok) return; // silence → D5 handles it (extension, then consent not obtained)
    for (const x of r.data.responses) if (seats.includes(x.seat)) await act(forumId, x.seat, { type: "sponsor_response", seat: x.seat, amendmentId, agree: x.agree });
  }

  return async function handle(forumId: string, effects: Effect[]) {
    for (const e of effects) {
      switch (e.type) {
        case "ai_attendance_needed":
          // App policy: AI delegations always declare "present" (no paid call needed).
          for (const seat of e.seats) enqueue(forumId, `att:${forumId}:${seat}`, () => act(forumId, seat, { type: "declare_attendance", seat, value: "present" }));
          break;
        case "ai_floor_decision_needed":
          enqueue(forumId, `floor:${forumId}:${e.windowId}`, () => onFloor(forumId, e.windowId));
          break;
        case "ai_vote_needed":
          enqueue(forumId, `vote:${forumId}:${e.ballotId}`, () => onVote(forumId, e.ballotId, e.seats));
          break;
        case "ai_speech_needed":
          enqueue(forumId, `speech:${forumId}:${e.seat}:${e.contextSeq}`, () => onSpeech(forumId, e.seat, e.contextSeq, e.maxWords));
          break;
        case "ai_volunteer_needed":
          // Heuristic (no paid call): one AI that has not yet spoken in this caucus volunteers.
          enqueue(forumId, `vol:${forumId}:${e.phaseId}`, async () => {
            const s = await loadState(db, forumId);
            if (!s || s.phaseId !== e.phaseId || !s.activeCaucus) return;
            const fresh = e.seats.filter((x) => !s.activeCaucus!.spokenSeats.includes(x));
            if (fresh.length) {
              const pick = fresh[parseInt(stableHash(e.phaseId).slice(0, 8), 16) % fresh.length];
              await act(forumId, pick, { type: "volunteer", seat: pick }, { phaseId: e.phaseId });
            }
          });
          break;
        case "ai_sponsor_response_needed":
          enqueue(forumId, `sponsor:${forumId}:${e.amendmentId}`, () => onSponsor(forumId, e.amendmentId, e.seats));
          break;
      }
    }
  };
}

function docText(s: ForumEngineState, docId: string) {
  const d = s.documents[docId];
  if (!d) return "(missing)";
  return [`"${d.title}"`, ...d.preambular.map((p) => `  ${p}`), ...d.operative.map((o, i) => `  ${i + 1}. ${o}`)].join("\n");
}

export type { PublicForumState };
