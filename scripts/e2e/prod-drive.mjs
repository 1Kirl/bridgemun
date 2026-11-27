// Production end-to-end driver (AUDIT TEST). Run via:
//   node scripts/with-env.mjs .env.project.local -- node scripts/e2e/prod-drive.mjs <cmd> [...args]
// Two test identities (A, B) are created with the Admin SDK (no passwords) and signed in with
// server-minted custom tokens. All meeting actions go through the PUBLIC production API routes;
// observation reads Firestore with the Admin SDK. State (forum id, cached tokens) lives in a
// git-ignored file under .data/. Nothing here prints secrets.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const APP = process.env.E2E_BASE_URL || "https://bridgemun.vercel.app";
const KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
mkdirSync(".data", { recursive: true });
const S = process.env.E2E_STATE || ".data/prod-e2e.json";
const st = existsSync(S) ? JSON.parse(readFileSync(S, "utf8")) : { tokens: {} };
const save = () => writeFileSync(S, JSON.stringify(st, null, 2));

// Local mode: FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST set → emulator project, no credentials.
const EMU = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const app = EMU
  ? initializeApp({ projectId: process.env.E2E_PROJECT_ID || "demo-bridgemun" })
  : initializeApp({ credential: cert(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"))), projectId: process.env.FIREBASE_PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

const USERS = {
  A: { uid: "audit-test-a", email: "audit-test-a@bridgemun.invalid", displayName: "AUDIT TEST A" },
  B: { uid: "audit-test-b", email: "audit-test-b@bridgemun.invalid", displayName: "AUDIT TEST B" },
};

async function ensureUsers() {
  for (const u of Object.values(USERS)) {
    try {
      await auth.getUser(u.uid);
    } catch {
      await auth.createUser({ uid: u.uid, email: u.email, displayName: u.displayName, emailVerified: false });
      console.log("created test user", u.uid);
    }
    // a profile doc like the app's register flow would create (only if absent)
    const ref = db.doc(`users/${u.uid}`);
    if (!(await ref.get()).exists) await ref.set({ displayName: u.displayName, email: u.email, createdAt: Date.now(), auditTest: true });
  }
}

async function token(name) {
  const c = st.tokens[name];
  if (c && c.exp > Date.now() + 120_000) return c.idToken;
  const custom = await auth.createCustomToken(USERS[name].uid, { auditTest: true });
  const idt = EMU ? `http://${EMU}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
  const r = await fetch(`${idt}/v1/accounts:signInWithCustomToken?key=${KEY || "demo-key"}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`token exchange failed: ${r.status} ${j.error?.message}`);
  st.tokens[name] = { idToken: j.idToken, exp: Date.now() + Number(j.expiresIn) * 1000 };
  save();
  return j.idToken;
}

export async function api(name, path, body, method = "POST") {
  const t = await token(name);
  const r = await fetch(APP + path, { method, headers: { Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const txt = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch {
    parsed = txt.slice(0, 200);
  }
  return { status: r.status, body: parsed };
}

const pub = async () => (await db.doc(`forums/${st.forumId}/engine/public`).get()).data()?.state;
const summary = (s) => {
  const p = s.phase;
  const b = p.ballotId ? s.ballots[p.ballotId] : null;
  return {
    phase: p.type,
    phaseId: s.phaseId,
    stage: p.stage,
    seat: p.seat,
    target: p.target,
    inSec: p.deadlineMs ? Math.round((p.deadlineMs - Date.now()) / 1000) : null,
    paused: s.paused ? { reason: s.paused.reason ?? "owner", resumeInSec: Math.round((s.paused.autoResumeAtMs - Date.now()) / 1000) } : null,
    speakers: s.speakersList,
    ballot: b && { id: b.id, kind: b.kind, subject: b.subject.type, voted: b.voted, status: b.status },
    docs: Object.values(s.documents ?? {}).map((d) => `${d.id}:${d.title}:v${d.version}:${d.status}:sp=${d.sponsors}:sig=${d.signatories}`),
    amendments: Object.values(s.amendments ?? {}).map((a) => `${a.id}:${a.targetDocId}:${a.op.kind}${a.op.clauseIndex + 1}:${a.status}:${a.friendlyOutcome ?? ""}:sig=${a.signatories}`),
    motions: Object.values(s.motions ?? {}).slice(-5).map((m) => `${m.id}:${m.params.type}:${m.mover}:${m.status}`),
    closed: p.reason ?? null,
    seats: Object.fromEntries(Object.values(s.seats).map((x) => [x.id, `${x.kind}/${x.attendance}/${x.connection}`])),
  };
};

const [cmd, ...rest] = process.argv.slice(2);
const out = (x) => console.log(typeof x === "string" ? x : JSON.stringify(x));

if (cmd === "users") {
  await ensureUsers();
  out("users ok");
} else if (cmd === "create") {
  // create <title> [agenda]
  const r = await api("A", "/api/forums", {
    title: rest[0] ?? "AUDIT TEST",
    agenda: rest[1] ?? "Pandemic vaccine sharing and technology transfer",
    committeeId: process.env.E2E_COMMITTEE || "WHO_HMUN",
    // E2E_COUNTRIES="us:United States,gb:United Kingdom,..." overrides the default five.
    countries: process.env.E2E_COUNTRIES
      ? process.env.E2E_COUNTRIES.split(",").map((x) => ({ code: x.split(":")[0], name: x.split(":")[1] }))
      : [
          { code: "us", name: "United States" },
          { code: "gb", name: "United Kingdom" },
          { code: "fr", name: "France" },
          { code: "de", name: "Germany" },
          { code: "jp", name: "Japan" },
        ],
    ownerCountry: "us",
    durationMin: Number(process.env.E2E_DURATION_MIN ?? 30),
    speakingTimeSec: 45,
    // E2E_TIMERS (JSON) overrides, e.g. a shorter responseWaitSec for local UI checks of the warnings.
    timers: { motionWindowSec: 30, readingSec: 5, votingSec: 30, humanPrepSec: 5, drPresentationSec: 30, drQaSec: 30, ...JSON.parse(process.env.E2E_TIMERS || "{}") },
  });
  if (r.status === 200 || r.status === 201) {
    st.forumId = r.body.forumId;
    st.code = r.body.joinCode;
    save();
  }
  out({ status: r.status, forumId: r.body.forumId, codeLength: r.body.joinCode?.length, error: r.body.error, message: r.body.message });
} else if (cmd === "lookup") {
  out(await api(rest[0] ?? "B", "/api/forums/lookup", { code: st.code }));
} else if (cmd === "join") {
  // join <who> <seat>
  out(await api(rest[0], `/api/forums/${st.forumId}/seat`, { code: st.code, seat: rest[1] }));
} else if (cmd === "cmd") {
  // cmd <who> '<json command>' ['<json expect>']
  out(await api(rest[0], `/api/forums/${st.forumId}/command`, { command: JSON.parse(rest[1]), expect: rest[2] ? JSON.parse(rest[2]) : undefined }));
} else if (cmd === "presence") {
  out(await api(rest[0], `/api/forums/${st.forumId}/presence`, { online: rest[1] !== "off" }));
} else if (cmd === "heartbeat") {
  // heartbeat <seconds> <who...>: keeps the listed humans "online" WITHOUT calling nudge (deadlines come from QStash only)
  const until = Date.now() + Number(rest[0]) * 1000;
  const who = rest.slice(1);
  while (Date.now() < until) {
    for (const w of who) await api(w, `/api/forums/${st.forumId}/presence`, { online: true }).catch(() => {});
    if ((await pub())?.phase.type === "CLOSED") break;
    await new Promise((r) => setTimeout(r, 20_000));
  }
  out("heartbeat done");
} else if (cmd === "state") {
  out(summary(await pub()));
} else if (cmd === "raw") {
  const s = await pub();
  out(rest[0] ? rest[0].split(".").reduce((o, k) => o?.[k], s) : s);
} else if (cmd === "wait") {
  // wait <jsPredicateOnSummary> [maxSec]  e.g. wait 's.phase==="FLOOR_OPEN"' 120
  const f = new Function("s", "full", `return (${rest[0]});`);
  const max = Number(rest[1] ?? 120) * 1000;
  const t0 = Date.now();
  for (;;) {
    const full = await pub();
    const s = summary(full);
    if (f(s, full)) {
      out({ reached: true, afterSec: Math.round((Date.now() - t0) / 1000), ...s });
      break;
    }
    if (Date.now() - t0 > max) {
      out({ reached: false, ...s });
      process.exitCode = 2;
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
} else if (cmd === "vote") {
  // vote <choiceA> <choiceB> [maxSec] [subjectType]: waits for an open ballot (voting stage) not yet voted by A/B, casts once each ("-" = skip)
  const max = Number(rest[2] ?? 120) * 1000;
  const t0 = Date.now();
  for (;;) {
    const s = await pub();
    const p = s.phase;
    const b = p.ballotId ? s.ballots[p.ballotId] : null;
    if (b && p.stage === "voting" && !b.voted.includes("us") && !b.voted.includes("gb") && (!rest[3] || b.subject.type === rest[3])) {
      for (const [who, seat, choice] of [["A", "us", rest[0]], ["B", "gb", rest[1]]]) {
        if (choice === "-") continue;
        const textHash = b.subject.textHash;
        const r = await api(who, `/api/forums/${st.forumId}/command`, { command: { type: "cast_vote", seat, ballotId: b.id, choice }, expect: { ballotId: b.id, ...(textHash ? { textHash } : {}) } });
        out(`${who} ${choice} on ${b.id} (${b.subject.type}) → ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      }
      break;
    }
    if (p.type === "CLOSED" || Date.now() - t0 > max) {
      out(`no ballot (${p.type})`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
} else if (cmd === "record") {
  const q = await db.collection(`forums/${st.forumId}/record`).orderBy("seq").get();
  for (const d of q.docs.slice(-Number(rest[0] ?? 40))) {
    const x = d.data();
    out(`#${x.seq} ${x.seat ?? "CHAIR"} ${x.source}: ${String(x.text).slice(0, Number(rest[1] ?? 200))}`);
  }
} else if (cmd === "ai") {
  const q = await db.collection(`forums/${st.forumId}/aiActions`).get();
  const rows = q.docs.map((d) => d.data()).sort((a, b) => a.atMs - b.atMs);
  for (const x of rows.slice(-Number(rest[0] ?? 60))) {
    out(`${new Date(x.atMs).toISOString().slice(11, 19)} ${x.seat ?? "-"} ${x.kind} ok=${x.ok} ${x.action ?? x.choice ?? ""} ${x.error ?? ""} ${x.matchLevel ?? ""} ${(x.evidence ?? []).join(",")} | ${(x.summary ?? "").slice(0, 110)}`);
  }
  out(`total aiActions: ${rows.length}`);
} else if (cmd === "usage") {
  const d = await db.doc(`forums/${st.forumId}/usage/ai`).get();
  out(d.exists ? d.data() : "(no usage doc at usage/ai)");
} else if (cmd === "forumdoc") {
  const d = (await db.doc(`forums/${st.forumId}`).get()).data();
  out({ title: d.title, status: d.status, positionSetVersion: d.positionSetVersion, schedulerError: d.schedulerError ?? null });
} else if (cmd === "use") {
  st.forumId = rest[0];
  st.code = rest[1] ?? (await db.doc(`forums/${rest[0]}`).get()).data()?.joinCode;
  save();
  out("using " + st.forumId);
} else {
  out("commands: users | create | lookup | join | cmd | presence | heartbeat | state | raw | wait | vote | record | ai | usage | forumdoc | use");
}
process.exit(process.exitCode ?? 0);
