import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpError } from "@/server/auth";
import {
  advanceIfDue,
  claimSeat,
  createForum,
  lookupByCode,
  userCommand,
} from "@/server/forums/service";
import { loadState } from "@/server/engine/store";
import { buildRuntime } from "@/server/runtime";

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const U = (uid: string) => ({ uid });

const COUNTRIES = [
  { code: "us", name: "United States" },
  { code: "gb", name: "United Kingdom" },
  { code: "fr", name: "France" },
  { code: "de", name: "Germany" },
  { code: "jp", name: "Japan" },
];
const input = (over: Record<string, unknown> = {}) => ({
  title: "Test forum",
  agenda: "Autonomous weapons verification",
  committeeId: "DISEC",
  countries: COUNTRIES,
  ownerCountry: "us",
  durationMin: 30,
  // These tests exercise the service and AI paths with the pre-W1 timers; W1 defaults are covered below.
  timers: { responseWaitSec: 0, briefingSec: 0 },
  ...over,
});

async function expectHttp(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).code).toBe(code);
    return;
  }
  throw new Error(`expected HttpError ${code}`);
}

describe.skipIf(!onEmulator)("forum service (Phase 2) on emulator", () => {
  let app: App;
  let db: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: "demo-bridgemun-svc" }, "forum-service-test");
    db = getFirestore(app);
  });
  afterAll(async () => app && deleteApp(app));

  async function membersOf(forumId: string) {
    const snap = await db.collection(`forums/${forumId}/members`).get();
    return Object.fromEntries(snap.docs.map((d) => [d.id, d.data().countryCode as string]));
  }
  async function humansOf(forumId: string) {
    const s = (await loadState(db, forumId))!;
    return Object.fromEntries(Object.values(s.seats).filter((x) => x.kind === "human").map((x) => [x.uid!, x.id]));
  }

  it("create: owner holds their chosen country as a delegate; every other seat is AI; code issued; clock not started", async () => {
    const { forumId, joinCode } = await createForum(db, U("owner"), input());
    expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const f = (await db.doc(`forums/${forumId}`).get()).data()!;
    expect(f).toMatchObject({ kind: "engine", status: "lobby", ownerUid: "owner", committeeId: "DISEC" });
    const s = (await loadState(db, forumId))!;
    expect(s.seats.us).toMatchObject({ kind: "human", uid: "owner" });
    expect(Object.values(s.seats).filter((x) => x.kind === "ai")).toHaveLength(4);
    expect(s.settings.sessionStartMs).toBe(0);
    expect(s.settings.policies.proceduralNonResponse).toBe("require_majority_of_eligible");
    expect(await membersOf(forumId)).toEqual({ owner: "us" });
  });

  it("new forums use W1 (5-minute response window) and the start briefing; start → BRIEFING for every member", async () => {
    const { timers: _legacy, ...plain } = input();
    void _legacy;
    const { forumId } = await createForum(db, U("owner"), plain);
    const s0 = (await loadState(db, forumId))!;
    expect(s0.settings.timers.responseWaitSec).toBe(300);
    expect(s0.settings.timers.briefingSec).toBe(12);
    await userCommand(db, U("owner"), forumId, { command: { type: "start" } });
    const s = (await loadState(db, forumId))!;
    expect(s.phase.type).toBe("BRIEFING");
    expect(s.settings.sessionStartMs).toBe((s.phase as { deadlineMs: number }).deadlineMs);
    await expectHttp(userCommand(db, U("owner"), forumId, { command: { type: "declare_attendance", seat: "us", value: "present" } }), "not_started");
  });

  it("create validation: unsupported committee, owner country missing, too few seats", async () => {
    await expectHttp(createForum(db, U("o"), input({ committeeId: "UNSC" })), "committee_not_supported");
    await expectHttp(createForum(db, U("o"), input({ ownerCountry: "kr" })), "owner_country_missing");
    await expectHttp(createForum(db, U("o"), input({ countries: COUNTRIES.slice(0, 2), ownerCountry: "us" })), "invalid_input");
  });

  it("lookup by code; unknown code 404", async () => {
    const { forumId, joinCode } = await createForum(db, U("owner"), input());
    const l = await lookupByCode(db, U("u2"), joinCode.toLowerCase());
    expect(l).toMatchObject({ forumId, isMember: false });
    expect(l.seats.find((x) => x.id === "fr")).toMatchObject({ kind: "ai" });
    await expectHttp(lookupByCode(db, U("u2"), "ZZZZZZ"), "code_not_found");
  });

  it("two users racing for the same country: exactly one wins; membership matches engine seats", async () => {
    for (let round = 0; round < 3; round++) {
      const { forumId, joinCode } = await createForum(db, U("owner"), input());
      const res = await Promise.allSettled([
        claimSeat(db, U("u2"), forumId, { code: joinCode, seat: "fr" }),
        claimSeat(db, U("u3"), forumId, { code: joinCode, seat: "fr" }),
      ]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rej = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((rej.reason as HttpError).code).toBe("seat_taken");
      expect(await membersOf(forumId)).toEqual(await humansOf(forumId));
    }
  });

  it("one user racing for two countries gets exactly one", async () => {
    const { forumId, joinCode } = await createForum(db, U("owner"), input());
    const res = await Promise.allSettled([
      claimSeat(db, U("u2"), forumId, { code: joinCode, seat: "fr" }),
      claimSeat(db, U("u2"), forumId, { code: joinCode, seat: "de" }),
    ]);
    // Exactly one real claim; the other is either refused or returned as a reconnect to the seat already held.
    const fresh = res.filter((r) => r.status === "fulfilled" && !(r.value as { reconnect: boolean }).reconnect);
    expect(fresh).toHaveLength(1);
    for (const r of res) {
      if (r.status === "fulfilled") expect((r.value as { seat: string }).seat).toBe((fresh[0] as PromiseFulfilledResult<{ seat: string }>).value.seat);
      else expect((r.reason as HttpError).code).toBe("already_seated");
    }
    const h = await humansOf(forumId);
    expect(Object.keys(h).filter((u) => u === "u2")).toHaveLength(1);
    expect(await membersOf(forumId)).toEqual(h);
  });

  it("start vs join race: roster, membership and lock are always consistent", async () => {
    for (let round = 0; round < 4; round++) {
      const { forumId, joinCode } = await createForum(db, U("owner"), input());
      const [startR, joinR] = await Promise.allSettled([
        userCommand(db, U("owner"), forumId, { command: { type: "start" } }),
        claimSeat(db, U("late"), forumId, { code: joinCode, seat: "de" }),
      ]);
      expect(startR.status).toBe("fulfilled");
      const s = (await loadState(db, forumId))!;
      expect(s.joinLocked).toBe(true);
      const members = await membersOf(forumId);
      expect(members).toEqual(await humansOf(forumId));
      if (joinR.status === "fulfilled") expect(members.late).toBe("de");
      else {
        expect((joinR.reason as HttpError).code).toBe("join_locked");
        expect(members.late).toBeUndefined();
        expect(s.seats.de.kind).toBe("ai");
      }
    }
  });

  it("after start: new users are refused; existing members reconnect to their own seat", async () => {
    const { forumId, joinCode } = await createForum(db, U("owner"), input());
    await claimSeat(db, U("u2"), forumId, { code: joinCode, seat: "gb" });
    await userCommand(db, U("owner"), forumId, { command: { type: "start" } });
    expect((await loadState(db, forumId))!.settings.sessionStartMs).toBeGreaterThan(0); // clock starts at start
    await expectHttp(lookupByCode(db, U("new"), joinCode), "forum_started");
    await expectHttp(claimSeat(db, U("new"), forumId, { code: joinCode, seat: "fr" }), "join_locked");
    // reconnect: even asking for another seat returns the member's own seat
    expect(await claimSeat(db, U("u2"), forumId, { code: joinCode, seat: "fr" })).toMatchObject({ seat: "gb", reconnect: true });
    expect(await lookupByCode(db, U("u2"), joinCode)).toMatchObject({ isMember: true });
    expect(await membersOf(forumId)).toEqual({ owner: "us", u2: "gb" });
  });

  it("forgery: acting for another seat, server-only commands, non-members", async () => {
    const { forumId, joinCode } = await createForum(db, U("owner"), input());
    await claimSeat(db, U("u2"), forumId, { code: joinCode, seat: "gb" });
    await userCommand(db, U("owner"), forumId, { command: { type: "start" } });
    await expectHttp(userCommand(db, U("u2"), forumId, { command: { type: "declare_attendance", seat: "us", value: "present" } }), "forbidden_seat");
    await expectHttp(userCommand(db, U("u2"), forumId, { command: { type: "tick" } }), "command_not_allowed");
    await expectHttp(userCommand(db, U("u2"), forumId, { command: { type: "connection", seat: "us", online: false } }), "command_not_allowed");
    await expectHttp(userCommand(db, U("u2"), forumId, { command: { type: "ai_speech_ready", seat: "fr", text: "x", contextSeq: 0 } }), "command_not_allowed");
    await expectHttp(userCommand(db, U("stranger"), forumId, { command: { type: "floor_pass", seat: "fr" } }), "not_a_member");
    await expectHttp(userCommand(db, U("u2"), forumId, { command: { type: "app_pause" } }), "owner_only");
    // the room owner acts only through their own seat
    await userCommand(db, U("owner"), forumId, { command: { type: "declare_attendance", seat: "us", value: "present" } });
    await expectHttp(userCommand(db, U("owner"), forumId, { command: { type: "declare_attendance", seat: "gb", value: "present" } }), "forbidden_seat");
  });

  it("lobby release frees the seat back to AI and removes membership", async () => {
    const { forumId, joinCode } = await createForum(db, U("owner"), input());
    await claimSeat(db, U("u2"), forumId, { code: joinCode, seat: "gb" });
    await userCommand(db, U("u2"), forumId, { command: { type: "release_seat", seat: "gb" } });
    expect(await membersOf(forumId)).toEqual({ owner: "us" });
    expect((await loadState(db, forumId))!.seats.gb.kind).toBe("ai");
  });

  it("deadline advancement is idempotent under concurrent nudges and never early", async () => {
    const { forumId } = await createForum(db, U("owner"), input());
    await userCommand(db, U("owner"), forumId, { command: { type: "start" } });
    let s = (await loadState(db, forumId))!;
    const deadline = (s.phase as { deadlineMs: number }).deadlineMs;
    expect(await advanceIfDue(db, forumId, undefined, () => deadline - 1)).toMatchObject({ advanced: false, reason: "not_due" });
    const results = await Promise.all(Array.from({ length: 5 }, () => advanceIfDue(db, forumId, undefined, () => deadline + 1)));
    expect(results.filter((r) => r.advanced)).toHaveLength(1);
    s = (await loadState(db, forumId))!;
    expect(s.phase.type).toBe("ROLL_CALL"); // no quorum (nobody declared) → a fresh roll call, exactly once
    expect(s.phaseSeq).toBe(2);
  });

  it("dummy AI driver declares AI attendance through the normal engine path", async () => {
    const rt = buildRuntime(db, { SCHEDULER_DRIVER: "local", AI_DRIVER: "dummy" });
    const { forumId } = await createForum(db, U("owner"), input());
    await userCommand(db, U("owner"), forumId, { command: { type: "start" } }, rt.sink);
    let s = (await loadState(db, forumId))!;
    for (let i = 0; i < 40 && !["gb", "fr", "de", "jp"].every((id) => s.seats[id].attendance === "present"); i++) {
      await new Promise((r) => setTimeout(r, 250));
      s = (await loadState(db, forumId))!;
    }
    for (const id of ["gb", "fr", "de", "jp"]) expect(s.seats[id].attendance).toBe("present");
    expect(s.seats.us.attendance).toBe("not_recorded"); // a human is never marked present automatically
    (rt.scheduler as unknown as { cancelAll?: () => void }).cancelAll?.();
  });
});
