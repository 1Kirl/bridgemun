import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { ScriptedLlm, type LlmMessage } from "@/server/ai/llm";
import { advanceIfDue, claimSeat, createForum, userCommand } from "@/server/forums/service";
import { loadState } from "@/server/engine/store";
import { buildRuntime, type Runtime } from "@/server/runtime";
import { MemoryAudioStore } from "@/server/speech/audioStore";
import { MockStt, MockTts } from "@/server/speech/providers";
import { transcribeSpeech } from "@/server/speech/transcribe";
import { BudgetExceeded, DEFAULT_CAPS, readUsage, reserve, type Caps } from "@/server/usage/budget";
import { HttpError } from "@/server/auth";
import type { ForumEngineState } from "@/engine/types";

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const U = (uid: string) => ({ uid });
const COUNTRIES = [
  { code: "us", name: "United States" },
  { code: "gb", name: "United Kingdom" },
  { code: "fr", name: "France" },
  { code: "de", name: "Germany" },
  { code: "jp", name: "Japan" },
];

async function until(db: Firestore, forumId: string, pred: (s: ForumEngineState) => boolean, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const s = (await loadState(db, forumId))!;
    if (pred(s)) return s;
    if (Date.now() - t0 > ms) throw new Error(`timeout; phase=${s.phase.type}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}
const allText = (m: LlmMessage[]) => m.map((x) => x.content).join("\n");

describe.skipIf(!onEmulator)("Phase 4–5 server pieces on the emulator (mock providers only)", () => {
  let app: App;
  let db: Firestore;
  let dir: string;
  beforeAll(() => {
    app = initializeApp({ projectId: "demo-bridgemun-p45" }, "phase45-test");
    db = getFirestore(app);
    // Two versions of the same (fixture) material set with OPPOSITE French positions.
    dir = mkdtempSync(path.join(os.tmpdir(), "positions-"));
    const base = JSON.parse(readFileSync(path.join(process.cwd(), "data/positions/fixture-v0.json"), "utf8"));
    writeFileSync(path.join(dir, "fixture-v0.json"), JSON.stringify(base));
    const flipped = { ...base, version: "fixture-flip", chunks: base.chunks.map((c: { id: string; text: string }) => (c.id === "fx-fr-vax-1" ? { ...c, text: "FIXTURE: France strongly supports compulsory licensing and will vote YES on texts that impose it." } : c)) };
    writeFileSync(path.join(dir, "fixture-flip.json"), JSON.stringify(flipped));
    process.env.POSITIONS_DIR = dir;
  });
  afterAll(async () => {
    delete process.env.POSITIONS_DIR;
    delete process.env.POSITION_SET_VERSION;
    if (app) await deleteApp(app);
  });

  it("budget: refuses over-cap reservations atomically (forum and day caps)", async () => {
    const caps: Caps = { perForum: { ...DEFAULT_CAPS.perForum, llm_calls: 2 }, perDay: { ...DEFAULT_CAPS.perDay } };
    await reserve(db, "bud1", { llm_calls: 1, llm_tokens: 10 }, caps);
    await reserve(db, "bud1", { llm_calls: 1, llm_tokens: 10 }, caps);
    await expect(reserve(db, "bud1", { llm_calls: 1, llm_tokens: 10 }, caps)).rejects.toBeInstanceOf(BudgetExceeded);
    expect(await readUsage(db, "bud1")).toMatchObject({ llm_calls: 2, llm_tokens: 20 });
  });

  async function setup(opts: { version?: string; script: (name: string, m: LlmMessage[]) => unknown; caps?: Partial<Caps["perForum"]> }) {
    process.env.POSITION_SET_VERSION = opts.version ?? "fixture-v0";
    const llm = new ScriptedLlm(opts.script);
    const rt = buildRuntime(
      db,
      {
        SCHEDULER_DRIVER: "local",
        ...(opts.caps?.llm_calls !== undefined ? { CAP_FORUM_LLM_CALLS: String(opts.caps.llm_calls) } : {}),
      },
      { llm, tts: new MockTts(), audioStore: new MemoryAudioStore(), stt: new MockStt(), delayMs: 5 },
    );
    const { forumId, joinCode } = await createForum(db, U("owner"), {
      title: "t",
      agenda: "Pandemic vaccine sharing",
      committeeId: "WHO_HMUN",
      countries: COUNTRIES,
      ownerCountry: "us",
      durationMin: 60,
    });
    await claimSeat(db, U("u2"), forumId, { code: joinCode, seat: "gb" }, rt.sink);
    await userCommand(db, U("owner"), forumId, { command: { type: "start" } }, rt.sink);
    await userCommand(db, U("owner"), forumId, { command: { type: "declare_attendance", seat: "us", value: "present" } }, rt.sink);
    await userCommand(db, U("u2"), forumId, { command: { type: "declare_attendance", seat: "gb", value: "present" } }, rt.sink);
    await until(db, forumId, (s) => s.phase.type === "FLOOR_OPEN"); // AI attendance (no paid call) closed the roll call
    return { rt, llm, forumId };
  }

  /** human motion → both humans ready → (AI passes) → vote opens; returns ballot id */
  async function humanMotionToVote(rt: Runtime, forumId: string) {
    await userCommand(db, U("u2"), forumId, { command: { type: "submit_motion", seat: "gb", params: { type: "unmod_caucus", totalSec: 300 } } }, rt.sink);
    await userCommand(db, U("owner"), forumId, { command: { type: "floor_pass", seat: "us" } }, rt.sink);
    await userCommand(db, U("u2"), forumId, { command: { type: "floor_pass", seat: "gb" } }, rt.sink);
    let s = await until(db, forumId, (x) => x.phase.type === "MOTION_VOTE");
    await advanceIfDue(db, forumId, rt.sink, () => (s.phase as { deadlineMs: number }).deadlineMs + 1); // reading → voting
    s = (await loadState(db, forumId))!;
    return (s.phase as { ballotId: string }).ballotId;
  }

  it("AI delegations vote automatically on a HUMAN motion, only for themselves; invalid choices are not executed", async () => {
    const { rt, llm, forumId } = await setup({
      script: (name) =>
        name === "floor_decision"
          ? { action: "pass", motion: null, rationale: "nothing to add", evidenceIds: [] }
          : name === "ballot_votes"
            ? {
                votes: [
                  { seat: "fr", choice: "yes", rationale: "time to negotiate", evidenceIds: [] },
                  { seat: "de", choice: "abstain", rationale: "invalid on procedural", evidenceIds: [] },
                  { seat: "jp", choice: "no", rationale: "prefer debate", evidenceIds: [] },
                  { seat: "us", choice: "no", rationale: "trying to vote for a human", evidenceIds: [] },
                ],
              }
            : new Error("unexpected"),
    });
    const ballotId = await humanMotionToVote(rt, forumId);
    const s = await until(db, forumId, (x) => Object.keys(x.ballots[ballotId].votes).length >= 2);
    const votes = s.ballots[ballotId].votes;
    expect(votes).toMatchObject({ fr: "yes", jp: "no" });
    expect(votes.us).toBeUndefined(); // AI never decides for a human seat
    expect(votes.de).toBeUndefined(); // abstain is not allowed on procedural → not executed (recorded as not voted)
    const log = await db.collection(`forums/${forumId}/aiActions`).where("kind", "==", "vote").get();
    expect(log.docs.some((d) => d.data().error?.startsWith("choice_not_allowed"))).toBe(true);
    expect(llm.calls.filter((c) => c.schemaName === "ballot_votes")).toHaveLength(1); // one batched call per ballot
    rt.scheduler.constructor.name === "LocalScheduler" && (rt.scheduler as unknown as { cancelAll(): void }).cancelAll();
  });

  it("changing the position material changes the AI's vote (evidence is actually used)", async () => {
    const decide = (name: string, m: LlmMessage[]) => {
      if (name === "floor_decision") return { action: "pass", motion: null, rationale: "", evidenceIds: [] };
      const t = allText(m);
      // A stand-in "model" that only follows the evidence text it was given.
      const frSupports = /France strongly supports compulsory licensing/.test(t);
      return { votes: [{ seat: "fr", choice: frSupports ? "yes" : "no", rationale: "per materials", evidenceIds: ["fx-fr-vax-1"] }] };
    };
    const a = await setup({ version: "fixture-v0", script: decide });
    const b1 = await humanMotionToVote(a.rt, a.forumId);
    const sa = await until(db, a.forumId, (x) => !!x.ballots[b1].votes.fr);
    const b = await setup({ version: "fixture-flip", script: decide });
    const b2 = await humanMotionToVote(b.rt, b.forumId);
    const sb = await until(db, b.forumId, (x) => !!x.ballots[b2].votes.fr);
    expect(sa.ballots[b1].votes.fr).toBe("no");
    expect(sb.ballots[b2].votes.fr).toBe("yes");
    const pinned = (await db.doc(`forums/${b.forumId}`).get()).data()!.positionSetVersion;
    expect(pinned).toBe("fixture-flip"); // version pinned on the forum
    const log = (await db.collection(`forums/${b.forumId}/aiActions`).where("kind", "==", "vote").get()).docs[0].data();
    expect(log).toMatchObject({ matchLevel: "exact", evidence: ["fx-fr-vax-1"] });
  });

  it("budget cap stops AI calls; the AI then simply does not vote (nothing fabricated)", async () => {
    const { rt, llm, forumId } = await setup({
      caps: { llm_calls: 0 },
      script: () => ({ votes: [{ seat: "fr", choice: "yes", rationale: "", evidenceIds: [] }] }),
    });
    const ballotId = await humanMotionToVote(rt, forumId);
    await new Promise((r) => setTimeout(r, 600));
    expect(llm.calls).toHaveLength(0);
    expect((await loadState(db, forumId))!.ballots[ballotId].votes.fr).toBeUndefined();
  });

  it("AI speech: generated text + mock TTS audio stored, engine plays it with server timing; logged", async () => {
    const { rt, forumId } = await setup({
      script: (name) =>
        name === "floor_decision"
          ? { action: "pass", motion: null, rationale: "", evidenceIds: [] }
          : name === "delegate_speech"
            ? { text: "France supports regional manufacturing hubs and voluntary licensing.", rationale: "per materials", evidenceIds: ["fx-fr-vax-1", "made-up-id"] }
            : { votes: [] },
    });
    await rt.sink(forumId, []); // no-op
    const { runCommand } = await import("@/server/engine/store");
    await runCommand(db, forumId, { actor: { kind: "ai", seat: "fr" }, command: { type: "add_to_speakers_list", seat: "fr" } }, { onEffects: rt.sink });
    await userCommand(db, U("owner"), forumId, { command: { type: "floor_pass", seat: "us" } }, rt.sink);
    await userCommand(db, U("u2"), forumId, { command: { type: "floor_pass", seat: "gb" } }, rt.sink);
    const s = await until(db, forumId, (x) => x.phase.type === "SPEECH" && x.phase.speakerKind === "ai");
    const p = s.phase as Extract<ForumEngineState["phase"], { type: "SPEECH" }>;
    expect(p.ai?.audioId).toBeTruthy();
    expect(p.ai?.durationMs).toBeGreaterThan(1000);
    expect(p.deadlineMs - p.ai!.playStartMs).toBe(Math.min(p.ai!.durationMs! + 1000, 60_000));
    expect(await rt.audioStore!.get(forumId, p.ai!.audioId!)).not.toBeNull();
    const log = (await db.collection(`forums/${forumId}/aiActions`).where("kind", "==", "speech").get()).docs[0].data();
    expect(log.evidence).toEqual(["fx-fr-vax-1"]); // invented ids are dropped
  });

  it("transcription: only the speaker awaiting confirmation may upload; transcript becomes ready, then is confirmed", async () => {
    const { rt, forumId } = await setup({ script: () => ({ action: "pass", motion: null, rationale: "", evidenceIds: [] }) });
    await userCommand(db, U("owner"), forumId, { command: { type: "add_to_speakers_list", seat: "us" } }, rt.sink);
    await userCommand(db, U("owner"), forumId, { command: { type: "floor_pass", seat: "us" } }, rt.sink);
    await userCommand(db, U("u2"), forumId, { command: { type: "floor_pass", seat: "gb" } }, rt.sink);
    let s = await until(db, forumId, (x) => x.phase.type === "SPEECH_PREP");
    await advanceIfDue(db, forumId, rt.sink, () => (s.phase as { deadlineMs: number }).deadlineMs + 1);
    await userCommand(db, U("owner"), forumId, { command: { type: "end_speech", seat: "us" } }, rt.sink);
    const audio = new Uint8Array(5000);
    await expect(transcribeSpeech(db, U("u2"), forumId, { audio, mime: "audio/webm", claimedSeconds: 20 }, { stt: rt.stt, caps: rt.caps })).rejects.toBeInstanceOf(HttpError);
    const out = await transcribeSpeech(db, U("owner"), forumId, { audio, mime: "audio/webm;codecs=opus", claimedSeconds: 20 }, { stt: rt.stt, caps: rt.caps });
    expect(out).toMatchObject({ ok: true, status: "ready", provider: "mock" });
    s = (await loadState(db, forumId))!;
    const ph = s.phase as Extract<ForumEngineState["phase"], { type: "SPEECH_CONFIRM" }>;
    expect(ph.transcript.text).toMatch(/MOCK TRANSCRIPT/);
    expect(s.contextSeq).toBeGreaterThanOrEqual(0);
    const before = s.contextSeq;
    await userCommand(db, U("owner"), forumId, { command: { type: "confirm_transcript", seat: "us", text: ph.transcript.text! } }, rt.sink);
    s = (await loadState(db, forumId))!;
    expect(s.contextSeq).toBe(before + 1); // only now does it reach AI context
    expect((await readUsage(db, forumId)).stt_seconds).toBe(20);
  });

  it("no AI calls when no human is online", async () => {
    const { rt, llm, forumId } = await setup({ script: () => ({ action: "pass", motion: null, rationale: "", evidenceIds: [] }) });
    await new Promise((r) => setTimeout(r, 800)); // let the first window's AI job finish before measuring
    const n = llm.calls.length;
    const { runCommand } = await import("@/server/engine/store");
    for (const seat of ["us", "gb"]) await runCommand(db, forumId, { actor: { kind: "system" }, command: { type: "connection", seat, online: false } }, { onEffects: rt.sink });
    const s = (await loadState(db, forumId))!;
    await advanceIfDue(db, forumId, rt.sink, () => (s.phase as { deadlineMs: number }).deadlineMs + 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(llm.calls.length).toBe(n);
  });

  it("unmoderated caucus: AI delegations draft and sign a resolution through the engine until it is approved", async () => {
    const { rt, forumId } = await setup({
      script: (name, m) => {
        if (name === "floor_decision") return { action: "pass", motion: null, rationale: "", evidenceIds: [] };
        if (name === "ballot_votes") return { votes: [{ seat: "fr", choice: "yes", rationale: "", evidenceIds: [] }, { seat: "de", choice: "yes", rationale: "", evidenceIds: [] }, { seat: "jp", choice: "yes", rationale: "", evidenceIds: [] }] };
        if (name === "caucus_work") {
          const t = allText(m);
          const you = /YOU ARE: [^(]+\((\w\w)\)/.exec(t)?.[1];
          const draftId = /- (d\d+) "/.exec(t)?.[1] ?? null;
          if (!draftId) return { action: "submit_draft", docId: null, draft: { title: "Regional Vaccine Hubs", preambular: ["Recognizing unequal access,"], operative: ["Establishes regional hubs;", "Requests annual reports."] }, rationale: `${you} drafts`, evidenceIds: ["fx-fr-vax-1"] };
          return { action: you === "de" ? "sponsor" : "sign", docId: draftId, draft: null, rationale: "fits", evidenceIds: [] };
        }
        return new Error("unexpected");
      },
    });
    await userCommand(db, U("u2"), forumId, { command: { type: "submit_motion", seat: "gb", params: { type: "unmod_caucus", totalSec: 300 } } }, rt.sink);
    await userCommand(db, U("owner"), forumId, { command: { type: "floor_pass", seat: "us" } }, rt.sink);
    await userCommand(db, U("u2"), forumId, { command: { type: "floor_pass", seat: "gb" } }, rt.sink);
    let s = await until(db, forumId, (x) => x.phase.type === "MOTION_VOTE");
    await advanceIfDue(db, forumId, rt.sink, () => (s.phase as { deadlineMs: number }).deadlineMs + 1);
    const bid = ((await loadState(db, forumId))!.phase as { ballotId: string }).ballotId;
    await userCommand(db, U("owner"), forumId, { command: { type: "cast_vote", seat: "us", ballotId: bid, choice: "yes" } }, rt.sink);
    await userCommand(db, U("u2"), forumId, { command: { type: "cast_vote", seat: "gb", ballotId: bid, choice: "yes" } }, rt.sink);
    s = await until(db, forumId, (x) => x.phase.type === "UNMOD_CAUCUS", 10000);
    s = await until(db, forumId, (x) => Object.values(x.documents).some((d) => d.status === "approved"), 12000);
    const d = Object.values(s.documents)[0];
    expect(d.sponsors.length).toBeGreaterThanOrEqual(2);
    expect(d.title).toBe("Regional Vaccine Hubs");
    const log = await db.collection(`forums/${forumId}/aiActions`).where("kind", "==", "caucus").get();
    expect(log.size).toBeGreaterThanOrEqual(2);
  });
});
