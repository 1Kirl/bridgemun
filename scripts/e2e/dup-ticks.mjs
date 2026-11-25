// Publishes N QStash deliveries for the same forum at the current phase deadline (+1s), distinct dedup ids,
// to verify that duplicate/late scheduler deliveries never cause more than one transition.
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const st = JSON.parse(readFileSync(process.env.E2E_STATE || ".data/prod-e2e.json", "utf8"));
const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"));
const db = getFirestore(initializeApp({ credential: cert(sa) }));
const s = (await db.doc(`forums/${st.forumId}/engine/public`).get()).data().state;
const at = (s.phase.deadlineMs ?? Date.now()) + 1000;
const n = Number(process.argv[2] ?? 5);
const target = `${process.env.APP_BASE_URL.replace(/\/$/, "")}/api/engine/tick`;
for (let i = 0; i < n; i++) {
  const r = await fetch(`https://qstash.upstash.io/v2/publish/${target}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.QSTASH_TOKEN}`, "Content-Type": "application/json", "Upstash-Not-Before": String(Math.ceil(at / 1000)), "Upstash-Deduplication-Id": `dup-test-${st.forumId}-${s.phaseId}-${i}-${Date.now()}` },
    body: JSON.stringify({ forumId: st.forumId, phaseId: s.phaseId, atMs: at }),
  });
  console.log(`published duplicate ${i + 1}/${n}: HTTP ${r.status}`);
}
console.log(JSON.stringify({ phaseId: s.phaseId, phaseSeq: s.phaseSeq, eventSeq: s.eventSeq, deliverAt: new Date(at).toISOString() }));
process.exit(0);
