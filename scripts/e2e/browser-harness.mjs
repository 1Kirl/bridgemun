// Multi-account REAL-BROWSER harness for BridgeMUN (Playwright).
//
//   node scripts/with-env.mjs .env.project.local -- node scripts/e2e/browser-harness.mjs [baseUrl]
//
// - One Chromium, one ISOLATED browser context per test account (own cookies, localStorage, IndexedDB).
// - Test accounts (e2e-ui-a/b/c) are created with the Admin SDK and signed in with server-minted custom tokens
//   through the official Firebase JS SDK inside each context — no password is typed into the site. (Sign-up / login
//   SCREENS are checked separately on localhost.)
// - Fake camera + microphone (Chromium flags); the microphone plays a synthetic speech WAV in a loop.
// - Instrumentation only: console errors, failed requests and HTMLMediaElement.play() results are recorded.
// - Control: a local HTTP endpoint (127.0.0.1:7781) receives one UI action at a time (click / fill / press /
//   goto / eval / shot / text). Every action is logged with time, account and target in the run folder.
// Run folders live in .data/e2e-browser/<run>/ (git-ignored): screenshots, actions.jsonl, errors.jsonl.
import { chromium } from "playwright";
import http from "node:http";
import { mkdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const BASE = process.argv[2] || "https://bridgemun.vercel.app";
const RUN = path.join(".data/e2e-browser", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(path.join(RUN, "shots"), { recursive: true });
const log = (file, o) => appendFileSync(path.join(RUN, file), JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");

const admin = initializeApp({ credential: cert(JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"))), projectId: process.env.FIREBASE_PROJECT_ID });
const auth = getAuth(admin);
const db = getFirestore(admin);
const USERS = {
  A: { uid: "e2e-ui-a", email: "e2e-ui-a@bridgemun.invalid", displayName: "E2E Tester A" },
  B: { uid: "e2e-ui-b", email: "e2e-ui-b@bridgemun.invalid", displayName: "E2E Tester B" },
  C: { uid: "e2e-ui-c", email: "e2e-ui-c@bridgemun.invalid", displayName: "E2E Tester C" },
  D: { uid: "e2e-ui-d", email: "e2e-ui-d@bridgemun.invalid", displayName: "E2E Tester D (late joiner)" },
};
for (const u of Object.values(USERS)) {
  try {
    await auth.getUser(u.uid);
  } catch {
    await auth.createUser({ uid: u.uid, email: u.email, displayName: u.displayName });
  }
  await db.doc(`users/${u.uid}`).set({ displayName: u.displayName, email: u.email, createdBy: "e2e-browser-harness" }, { merge: true });
}

const FIREBASE_CFG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const SDK = "https://www.gstatic.com/firebasejs/12.11.0";

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${path.resolve(".data/e2e-browser/speech.wav")}`,
    "--autoplay-policy=document-user-activation-required",
  ],
});

const pages = {};
const contexts = {};
function watch(who, page) {
  page.on("console", (m) => m.type() === "error" && log("errors.jsonl", { who, kind: "console", text: m.text().slice(0, 400) }));
  page.on("pageerror", (e) => log("errors.jsonl", { who, kind: "pageerror", text: String(e).slice(0, 400) }));
  page.on("requestfailed", (r) => log("errors.jsonl", { who, kind: "requestfailed", url: r.url().slice(0, 200), err: r.failure()?.errorText }));
  page.on("response", (r) => r.status() >= 400 && r.url().startsWith(BASE) && log("errors.jsonl", { who, kind: "http", status: r.status(), url: r.url().slice(0, 200) }));
}
async function open(who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone", "camera"] });
  await ctx.grantPermissions(["microphone", "camera"], { origin: BASE });
  // Instrumentation: record every media play() attempt (AI speech playback check). Does not change behaviour.
  await ctx.addInitScript(() => {
    window.__bmPlays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const rec = { at: Date.now(), src: String(this.currentSrc || this.src || "").slice(0, 40), startAt: this.currentTime, tag: this.tagName };
      window.__bmPlays.push(rec);
      const p = orig.call(this);
      p?.then?.(() => (rec.ok = true), (e) => (rec.err = e?.name || String(e)));
      return p;
    };
  });
  contexts[who] = ctx;
  const page = await ctx.newPage();
  watch(who, page);
  await page.goto(`${BASE}/?intro=off`);
  const token = await auth.createCustomToken(USERS[who].uid);
  await page.evaluate(
    async ({ cfg, token, sdk }) => {
      const { initializeApp } = await import(`${sdk}/firebase-app.js`);
      const { getAuth, signInWithCustomToken } = await import(`${sdk}/firebase-auth.js`);
      const app = initializeApp(cfg);
      await signInWithCustomToken(getAuth(app), token);
    },
    { cfg: FIREBASE_CFG, token, sdk: SDK },
  );
  await page.reload();
  pages[who] = page;
  log("actions.jsonl", { who, action: "signin", via: "custom token (Admin SDK) in isolated context" });
}
for (const who of ["A", "B", "C"]) await open(who);

async function handle(body) {
  if (body.action === "login") {
    await open(body.who); // e.g. the late joiner D
    return { ok: true };
  }
  if (body.action === "newpage") {
    // the same account (same isolated context / sign-in) comes back in a fresh tab
    const page = await contexts[body.who].newPage();
    watch(body.who, page);
    await page.goto(body.url.startsWith("http") ? body.url : `${BASE}${body.url}`);
    pages[body.who] = page;
    log("actions.jsonl", { who: body.who, action: "newpage", url: body.url });
    return { ok: true };
  }
  const page = pages[body.who];
  if (!page) throw new Error(`unknown account ${body.who}`);
  if (body.action === "closepage") {
    await page.close({ runBeforeUnload: true }); // leaving: the app sends its offline beacon on pagehide
    delete pages[body.who];
    log("actions.jsonl", { who: body.who, action: "closepage" });
    return { ok: true };
  }
  const t = body.timeout ?? 15000;
  const r = { ok: true };
  switch (body.action) {
    case "goto":
      await page.goto(body.url.startsWith("http") ? body.url : `${BASE}${body.url}`);
      break;
    case "click":
      await page.locator(body.selector).first().click({ timeout: t });
      break;
    case "fill":
      await page.locator(body.selector).first().fill(body.value, { timeout: t });
      break;
    case "type":
      await page.locator(body.selector).first().pressSequentially(body.value, { timeout: t, delay: 5 });
      break;
    case "select":
      await page.locator(body.selector).first().selectOption(body.value, { timeout: t });
      break;
    case "press":
      await page.keyboard.press(body.key);
      break;
    case "wait":
      await page.locator(body.selector).first().waitFor({ state: body.state ?? "visible", timeout: t });
      break;
    case "eval":
      r.value = await page.evaluate(body.js);
      break;
    case "text":
      r.value = (await page.locator(body.selector ?? "body").first().innerText({ timeout: t })).slice(0, body.max ?? 4000);
      break;
    case "shot": {
      const file = path.join(RUN, "shots", `${body.name}-${body.who}.png`);
      await page.screenshot({ path: file, fullPage: !!body.full });
      r.file = file;
      break;
    }
    case "reload":
      await page.reload();
      break;
    default:
      throw new Error(`unknown action ${body.action}`);
  }
  log("actions.jsonl", { who: body.who, action: body.action, selector: body.selector, url: body.url, value: body.action === "fill" || body.action === "type" ? String(body.value).slice(0, 120) : undefined, name: body.name });
  return r;
}

http
  .createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", async () => {
      try {
        if (req.url === "/quit") {
          res.end("bye");
          await browser.close();
          process.exit(0);
        }
        const out = await handle(JSON.parse(data || "{}"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        log("actions.jsonl", { error: String(e).slice(0, 300), req: data.slice(0, 300) });
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 500) }));
      }
    });
  })
  .listen(7781, "127.0.0.1", () => {
    writeFileSync(path.join(RUN, "README.txt"), `BridgeMUN browser run against ${BASE}\nAccounts: A, B, C (isolated contexts)\n`);
    console.log(`harness ready ${BASE} run=${RUN}`);
  });
void existsSync;
