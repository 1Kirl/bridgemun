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
  CAUCUS_WORK_SCHEMA,
  CAUCUS_AMEND_SCHEMA,
  VOTING_MOTION_SCHEMA,
  amendmentsBlock,
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
  /** Backoff before the single retry of a transient provider error (default 2000 ms). */
  retryDelayMs?: number;
  /** Registers background work so the request can await it after responding (serverless). */
  track?: (p: Promise<unknown>) => void;
};

const FloorZ = z.object({
  action: z.enum(["pass", "request_floor", "move_motion"]),
  motion: z
    .object({
      type: z.enum(["mod_caucus", "unmod_caucus", "set_speaking_time", "introduce_resolution", "introduce_amendment", "enter_voting"]),
      topic: z.string(),
      speakingSec: z.number().int(),
      totalSec: z.number().int(),
    })
    .nullable(),
  rationale: z.string().max(2000),
  evidenceIds: z.array(z.string()).max(10),
});
const VotesZ = z.object({
  votes: z.array(z.object({ seat: z.string(), choice: z.enum(["yes", "no", "abstain"]), rationale: z.string().max(2000), evidenceIds: z.array(z.string()).max(10) })),
});
const SpeechZ = z.object({ text: z.string().min(1).max(4000), rationale: z.string().max(2000), evidenceIds: z.array(z.string()).max(10) });
const CaucusZ = z.object({
  action: z.enum(["nothing", "sponsor", "sign", "submit_draft"]),
  docId: z.string().nullable(),
  draft: z.object({ title: z.string(), preambular: z.array(z.string()), operative: z.array(z.string()) }).nullable(),
  rationale: z.string().max(2000),
  evidenceIds: z.array(z.string()).max(10),
});
const CaucusAmendZ = z.object({
  action: z.enum(["nothing", "propose_amendment", "sign_amendment"]),
  amendmentId: z.string().nullable(),
  amendment: z
    .object({ docId: z.string(), kind: z.enum(["replace", "insert", "delete"]), clauseNumber: z.number().int(), text: z.string() })
    .nullable(),
  rationale: z.string().max(2000),
  evidenceIds: z.array(z.string()).max(10),
});
const VotingMotionZ = z.object({
  action: z.enum(["pass", "reorder", "divide", "propose_division"]),
  order: z.array(z.string()).max(10),
  separateClauses: z.array(z.array(z.number().int())).max(6),
  rationale: z.string().max(2000),
});
const SponsorZ = z.object({ responses: z.array(z.object({ seat: z.string(), agree: z.boolean(), rationale: z.string().max(2000) })) });

/** Provider errors worth one retry: overload/5xx, rate limit (429), timeouts and network failures. */
export const isTransient = (error: string) => /^openai_http_(5\d\d|429)|^openai_(timeout|network)/.test(error);

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
    if (!r.ok && isTransient(r.error)) {
      // One delayed retry for provider-side transient failures (seen in production: HTTP 503 "server_is_overloaded").
      // Budgeted like any call; still bounded by the engine deadline, after which the seat simply did not act.
      await new Promise((res) => setTimeout(res, cfg.retryDelayMs ?? 2000));
      try {
        await reserve(db, forumId, { llm_calls: 1, llm_tokens: estimate }, cfg.caps);
        r = await cfg.llm.generate(req);
      } catch (e) {
        if (!(e instanceof BudgetExceeded)) throw e;
      }
    }
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
              `THE FLOOR IS OPEN. Choose ONE: "pass"; "request_floor" (join the speakers' list to make a statement); or "move_motion" with a moderated caucus (topic, speakingSec 30-90, totalSec 180-600), unmoderated caucus (totalSec 180-600; lets delegations draft and sign resolutions), set_speaking_time (speakingSec 30-120), introduce_resolution (only if an APPROVED draft exists), introduce_amendment (put "topic" = an amendment id listed under AMENDMENTS as ready; only if you proposed or signed it) or enter_voting (only if resolutions were introduced and debate has been sufficient). Prefer pass unless it clearly serves your country's goals. Motions are procedural; unused numeric fields may be 0.`,
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
        const m = d.motion;
        const p: MotionParams =
          m.type === "mod_caucus"
            ? { type: "mod_caucus", topic: m.topic.slice(0, 120) || "Key concerns", speakingSec: m.speakingSec, totalSec: m.totalSec }
            : m.type === "unmod_caucus"
              ? { type: "unmod_caucus", totalSec: m.totalSec }
              : m.type === "set_speaking_time"
                ? { type: "set_speaking_time", speakingSec: m.speakingSec }
                : m.type === "introduce_amendment"
                  ? { type: "introduce_amendment", amendmentId: m.topic.trim() }
                  : { type: m.type };
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
        ? `PROCEDURAL VOTE on motion: ${motionText(L.pub, b.subject.motionId)}.${L.state.motions[b.subject.motionId]?.params.type === "reorder_resolutions" ? ` Current voting order: ${(L.state.votingOrder ?? []).join(" → ")} (rule 34).` : ""} Choices: yes/no. Consider which issues you want debated, remaining time and negotiation strategy.\n${Object.values(L.state.documents)
            .filter((d) => d.status === "introduced" || d.status === "approved")
            .slice(0, 3)
            .map((d) => `Document under consideration ${d.id} (${d.status}):\n${docText(L.state, d.id)}`)
            .join("\n")}`
        : b.subject.type === "resolution"
          ? `SUBSTANTIVE VOTE on resolution ${b.subject.docId} v${b.subject.version}:\n${docText(L.state, b.subject.docId)}\nJudge each operative clause against your position materials.`
          : b.subject.type === "amendment"
            ? `SUBSTANTIVE VOTE (2/3) on amendment ${b.subject.amendmentId} to ${L.state.amendments[b.subject.amendmentId]?.targetDocId}: ${amendmentText(L.state, b.subject.amendmentId)}\nCurrent text:\n${docText(L.state, L.state.amendments[b.subject.amendmentId]?.targetDocId ?? "")}`
            : b.subject.type === "division_proposal"
              ? `SUBSTANTIVE VOTE on a proposal to DIVIDE resolution ${b.subject.docId} into separately voted parts: ${divisionText(L.state, b.subject.proposalId)}\n${docText(L.state, b.subject.docId)}\nVote yes if voting these parts separately lets you keep the clauses you support while removing ones you oppose.`
              : `SUBSTANTIVE VOTE on whether to KEEP part ${b.subject.part + 1} of resolution ${b.subject.docId} in the final text: ${partText(L.state, b.subject.docId, b.subject.part)}\nJudge these clauses against your position materials.`;
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

  // ── unmoderated caucus: sponsor/sign/draft documents ─────────────
  async function onCaucusWork(forumId: string, phaseId: string, seats: string[], trigger?: string) {
    const L = await load(forumId);
    if (!L || !shouldAct(L.state) || L.state.phaseId !== phaseId) return;
    const start = parseInt(stableHash(phaseId).slice(0, 8), 16);
    const consult = seats.map((_, i) => seats[(start + i) % seats.length]).slice(0, cfg.floorConsultPerWindow + 1);
    for (const seat of consult) {
      const fresh = await loadState(db, forumId);
      if (!fresh || fresh.phaseId !== phaseId) return;
      const pub = toPublicState(fresh);
      const introduced = Object.values(fresh.documents).filter((d) => d.status === "introduced");
      // A new amendment, or (at caucus start, once resolutions are on the floor) every other delegation: amendment work (rule 29).
      if ((trigger && fresh.amendments[trigger]) || (!trigger && introduced.length && !fresh.debateClosed && consult.indexOf(seat) % 2 === 0)) {
        await amendmentWork(forumId, L, fresh, pub, seat);
        continue;
      }
      const docs = Object.values(fresh.documents).filter((d) => (d.status === "draft" || d.status === "approved") && (!trigger || d.id === trigger));
      if (trigger && !docs.length) return;
      const ev = retr(L, seat, `${L.ctx.agenda} resolution draft`);
      const docList = docs.length
        ? docs.map((d) => `- ${d.id} "${d.title}" (${d.status}; sponsors ${d.sponsors.join(",")}; signatories ${d.signatories.join(",")})\n${docText(fresh, d.id)}`).join("\n")
        : "(no drafts yet)";
      const r = await callLlm(forumId, {
        model: cfg.models.speech,
        schemaName: "caucus_work",
        schema: CAUCUS_WORK_SCHEMA,
        maxOutputTokens: 900,
        validate: parseWith(CaucusZ),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              situation(L.ctx, pub, seat),
              evidenceBlock(ev),
              `UNMODERATED CAUCUS. Draft resolutions on the floor:\n${docList}`,
              trigger
                ? `A delegation has just shared draft ${trigger}. Choose ONE: "nothing"; or "sponsor" / "sign" it (docId ${trigger}). Signing means it deserves debate, not support; sponsor only if it fits your position. Do not submit a new draft now.`
                : `Choose ONE: "nothing"; "sponsor" or "sign" an existing draft (docId) only if it fits your position (signing means it deserves debate, not support); or "submit_draft" with a short draft (title, 1-3 preambular clauses, 2-4 operative clauses beginning with a verb) if no existing draft reflects your country's priorities.`,
            ].join("\n\n"),
          },
        ],
      });
      if (!r.ok) {
        await logAction(forumId, { seat, kind: "caucus", ok: false, error: r.error });
        continue;
      }
      const d = r.data;
      let res: Awaited<ReturnType<typeof act>> | null = null;
      if ((d.action === "sponsor" || d.action === "sign") && d.docId && fresh.documents[d.docId]) {
        res = await act(forumId, seat, { type: "sign_document", seat, docId: d.docId, role: d.action === "sponsor" ? "sponsor" : "signatory" });
      } else if (!trigger && d.action === "submit_draft" && d.draft && d.draft.operative.length) {
        res = await act(forumId, seat, {
          type: "submit_document",
          seat,
          kind: "draft_resolution",
          title: d.draft.title.slice(0, 120),
          preambular: d.draft.preambular.slice(0, 5).map((x) => x.slice(0, 600)),
          operative: d.draft.operative.slice(0, 8).map((x) => x.slice(0, 800)),
        });
      }
      await logAction(forumId, { seat, kind: "caucus", ok: res ? res.ok : true, action: d.action, docId: d.docId ?? null, summary: d.rationale.slice(0, 400), evidence: d.evidenceIds.filter((id) => ev.chunks.some((c) => c.id === id)), matchLevel: ev.matchLevel, model: r.model, ...(res && !res.ok ? { error: res.code } : {}) });
    }
  }

  async function amendmentWork(forumId: string, L: NonNullable<Awaited<ReturnType<typeof load>>>, fresh: ForumEngineState, pub: PublicForumState, seat: string) {
    const introduced = Object.values(fresh.documents).filter((d) => d.status === "introduced");
    const ev = retr(L, seat, `${L.ctx.agenda} ${introduced.map((d) => d.operative.join(" ")).join(" ")}`);
    const r = await callLlm(forumId, {
      model: cfg.models.decision,
      schemaName: "amendment_work",
      schema: CAUCUS_AMEND_SCHEMA,
      maxOutputTokens: 600,
      validate: parseWith(CaucusAmendZ),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            situation(L.ctx, pub, seat),
            evidenceBlock(ev),
            `INTRODUCED RESOLUTIONS (only these can be amended; rule 29):\n${introduced.map((d) => `${d.id} (sponsors ${d.sponsors.join(",")})\n${docText(fresh, d.id)}`).join("\n")}`,
            amendmentsBlock(pub),
            `Choose ONE: "nothing"; "sign_amendment" (amendmentId of an open draft amendment you want debated — signing is not support); or "propose_amendment" (docId, kind replace/insert/delete, clauseNumber = 1-based operative clause number; for insert the new clause goes BEFORE that number, use count+1 to append; text = the full clause, empty for delete). Propose only a precise change your materials clearly support; do not amend resolutions you sponsor unless needed.`,
          ].join("\n\n"),
        },
      ],
    });
    if (!r.ok) {
      await logAction(forumId, { seat, kind: "amendment", ok: false, error: r.error });
      return;
    }
    const d = r.data;
    let res: Awaited<ReturnType<typeof act>> | null = null;
    if (d.action === "sign_amendment" && d.amendmentId && fresh.amendments[d.amendmentId]) {
      res = await act(forumId, seat, { type: "sign_amendment", seat, amendmentId: d.amendmentId });
    } else if (d.action === "propose_amendment" && d.amendment && fresh.documents[d.amendment.docId]) {
      const a = d.amendment;
      const idx = a.clauseNumber - 1;
      const op =
        a.kind === "delete"
          ? ({ kind: "delete", clauseIndex: idx } as const)
          : ({ kind: a.kind, clauseIndex: idx, text: a.text.trim().slice(0, 800) } as const);
      res = await act(forumId, seat, { type: "submit_amendment", seat, targetDocId: a.docId, op });
    }
    await logAction(forumId, { seat, kind: "amendment", ok: res ? res.ok : true, action: d.action, amendmentId: d.amendmentId ?? null, summary: d.rationale.slice(0, 400), evidence: d.evidenceIds.filter((id) => ev.chunks.some((c) => c.id === id)), matchLevel: ev.matchLevel, model: r.model, ...(res && !res.ok ? { error: res.code } : {}) });
  }

  // ── voting procedure: reorder (rule 34), divide (rule 33), division proposals ──
  async function onVotingMotion(forumId: string, phaseId: string, seats: string[]) {
    const L = await load(forumId);
    if (!L || !shouldAct(L.state) || L.state.phaseId !== phaseId) return;
    const p = L.state.phase;
    if (p.type !== "VP_FLOOR" && p.type !== "DIVISION_PROPOSALS") return;
    const start = parseInt(stableHash(phaseId).slice(0, 8), 16);
    const consult = seats.map((_, i) => seats[(start + i) % seats.length]).slice(0, cfg.floorConsultPerWindow);
    const docId = p.type === "DIVISION_PROPOSALS" ? p.docId : p.target.kind === "division" ? p.target.docId : null;
    const order = L.state.votingOrder ?? [];
    const task =
      p.type === "DIVISION_PROPOSALS"
        ? `The committee agreed to DIVIDE resolution ${docId}. You may "propose_division": separateClauses = groups of 1-based operative clause numbers to vote separately (remaining clauses form one more part). Propose only if separating clauses lets your country remove clauses it opposes or keep ones it supports. Otherwise "pass".`
        : p.target.kind === "order"
          ? `VOTING PROCEDURE. Current voting order: ${order.join(", ")}. You may "reorder" (order = every resolution id exactly once) only if voting another resolution first clearly serves your country (e.g. your preferred text first). Otherwise "pass".`
          : `VOTING PROCEDURE. Resolution ${docId} is about to be voted on. You may "divide" (motion to vote some operative clauses separately) only if it contains clauses your country strongly opposes next to ones it supports. Otherwise "pass".`;
    const docs = (docId ? [docId] : order).map((id) => `${id}:\n${docText(L.state, id)}`).join("\n");
    for (const seat of consult) {
      const fresh = await loadState(db, forumId);
      if (!fresh || fresh.phaseId !== phaseId) return;
      const ev = retr(L, seat, `${L.ctx.agenda} ${docs}`);
      const r = await callLlm(forumId, {
        model: cfg.models.decision,
        schemaName: "voting_motion",
        schema: VOTING_MOTION_SCHEMA,
        maxOutputTokens: 300,
        validate: parseWith(VotingMotionZ),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: [situation(L.ctx, L.pub, seat), evidenceBlock(ev), docs, task, "Unused fields: empty arrays."].join("\n\n") },
        ],
      });
      if (!r.ok) {
        await logAction(forumId, { seat, kind: "voting_motion", phaseId, ok: false, error: r.error });
        continue;
      }
      const d = r.data;
      let res: Awaited<ReturnType<typeof act>> | null = null;
      if (d.action === "reorder" && p.type === "VP_FLOOR" && p.target.kind === "order") {
        res = await act(forumId, seat, { type: "submit_motion", seat, params: { type: "reorder_resolutions", order: d.order } }, { phaseId });
      } else if (d.action === "divide" && docId && p.type === "VP_FLOOR") {
        res = await act(forumId, seat, { type: "submit_motion", seat, params: { type: "divide_question", docId } }, { phaseId });
      } else if (d.action === "propose_division" && docId && p.type === "DIVISION_PROPOSALS" && d.separateClauses.length) {
        res = await act(forumId, seat, { type: "submit_division_proposal", seat, docId, parts: d.separateClauses.map((g) => g.map((n) => n - 1)) }, { phaseId });
      }
      await logAction(forumId, { seat, kind: "voting_motion", phaseId, ok: res ? res.ok : true, action: d.action, summary: d.rationale.slice(0, 400), evidence: ev.chunks.map((c) => c.id), matchLevel: ev.matchLevel, model: r.model, ...(res && !res.ok ? { error: res.code } : {}) });
    }
    const s = await loadState(db, forumId);
    if (!s || s.phaseId !== phaseId) return;
    for (const seat of seats) await act(forumId, seat, { type: "floor_pass", seat }, { phaseId });
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
        case "ai_caucus_work_needed":
          enqueue(forumId, `caucus:${forumId}:${e.phaseId}:${e.trigger ?? "start"}`, () => onCaucusWork(forumId, e.phaseId, e.seats, e.trigger));
          break;
        case "ai_sponsor_response_needed":
          enqueue(forumId, `sponsor:${forumId}:${e.amendmentId}`, () => onSponsor(forumId, e.amendmentId, e.seats));
          break;
        case "ai_voting_motion_needed":
          enqueue(forumId, `vpm:${forumId}:${e.phaseId}`, () => onVotingMotion(forumId, e.phaseId, e.seats));
          break;
      }
    }
  };
}

function amendmentText(s: ForumEngineState, id: string) {
  const a = s.amendments[id];
  if (!a) return "(missing)";
  return a.op.kind === "delete" ? `delete operative clause ${a.op.clauseIndex + 1}` : `${a.op.kind} operative clause ${a.op.clauseIndex + 1}: "${a.op.text}"`;
}
function divisionText(s: ForumEngineState, proposalId: string) {
  const pr = s.divisionProposals?.[proposalId];
  return pr ? pr.parts.map((x, i) => `part ${i + 1} = clauses ${x.clauses.map((n) => n + 1).join(", ")}`).join("; ") : "(missing)";
}
function partText(s: ForumEngineState, docId: string, part: number) {
  const div = s.divisions?.[docId];
  const pr = div?.adoptedProposalId ? s.divisionProposals?.[div.adoptedProposalId] : undefined;
  if (!div || !pr) return "(missing)";
  return pr.parts[part].clauses.map((i) => `${i + 1}. ${div.baseOperative[i]}`).join("\n");
}

function docText(s: ForumEngineState, docId: string) {
  const d = s.documents[docId];
  if (!d) return "(missing)";
  return [`"${d.title}"`, ...d.preambular.map((p) => `  ${p}`), ...d.operative.map((o, i) => `  ${i + 1}. ${o}`)].join("\n");
}

export type { PublicForumState };
