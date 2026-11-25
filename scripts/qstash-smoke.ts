/**
 * End-to-end check of deadline scheduling on the DEPLOYED app via real QStash.
 * Creates a clearly labelled test forum directly in Firestore (Admin SDK; no Auth accounts), starts it,
 * which publishes a QStash message for the roll-call deadline. No local process advances it, so if the
 * phase moves on, QStash delivered a signed request to the production /api/engine/tick.
 * The test forum is deleted afterwards.
 *   node scripts/with-env.mjs .env.project.local -- npx tsx --conditions=react-server scripts/qstash-smoke.ts
 */
import { adminDb } from "../src/server/firebaseAdmin";
import { createForum, userCommand } from "../src/server/forums/service";
import { loadState, runCommand } from "../src/server/engine/store";
import { createScheduler } from "../src/server/scheduler";
import type { Effect } from "../src/engine/types";

(async () => {
  const db = adminDb();
  const scheduler = createScheduler({ ...process.env, SCHEDULER_DRIVER: "qstash" }, async () => {});
  const published: string[] = [];
  const sink = async (forumId: string, effects: Effect[]) => {
    for (const e of effects) if (e.type === "schedule") {
      await scheduler.schedule({ forumId, phaseId: e.phaseId, atMs: e.atMs });
      published.push(`${e.phaseId}@${new Date(e.atMs).toISOString()}`);
    }
  };
  const owner = { uid: "smoke-test-owner" };
  const { forumId } = await createForum(db, owner, {
    title: "[SMOKE TEST] QStash scheduling — safe to delete",
    agenda: "Scheduler smoke test",
    committeeId: "DISEC",
    countries: [{ code: "us", name: "United States" }, { code: "fr", name: "France" }, { code: "de", name: "Germany" }],
    ownerCountry: "us",
    durationMin: 15,
  });
  // Owner offline → the deployed AI driver makes no paid calls for this test forum.
  await runCommand(db, forumId, { actor: { kind: "system" }, command: { type: "connection", seat: "us", online: false } });
  await userCommand(db, owner, forumId, { command: { type: "start" } }, sink);
  const s0 = (await loadState(db, forumId))!;
  console.log(`forum ${forumId} started: phase=${s0.phase.type} ${s0.phaseId}; published to QStash: ${published.join(", ")}`);
  const deadline = (s0.phase as { deadlineMs: number }).deadlineMs;
  let s = s0;
  while (Date.now() < deadline + 45_000) {
    await new Promise((r) => setTimeout(r, 5000));
    s = (await loadState(db, forumId))!;
    if (s.phaseSeq > s0.phaseSeq) break;
  }
  const lag = (Date.now() - deadline) / 1000;
  console.log(
    s.phaseSeq > s0.phaseSeq
      ? `QSTASH OK: phase advanced ${s0.phaseId} → ${s.phaseId} (${s.phase.type}); observed ≤${lag.toFixed(0)}s after deadline, by the deployed tick endpoint`
      : `QSTASH NOT CONFIRMED: phase still ${s.phaseId} ${lag.toFixed(0)}s after deadline`,
  );
  const events = await db.collection(`forums/${forumId}/events`).orderBy("seq").get();
  console.log(`events: ${events.docs.map((d) => `${d.data().seq}:${d.data().command}:${d.data().actor.kind}`).join(" ")}`);
  // cleanup
  await db.recursiveDelete(db.doc(`forums/${forumId}`));
  const code = (await db.collection("joinCodes").where("forumId", "==", forumId).get()).docs;
  for (const d of code) await d.ref.delete();
  console.log("test forum deleted");
  process.exit(0);
})().catch((e) => {
  console.error("smoke failed:", (e as Error).message);
  process.exit(1);
});
