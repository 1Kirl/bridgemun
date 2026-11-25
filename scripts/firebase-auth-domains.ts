/**
 * Lists / adds Firebase Authentication authorized domains via the Identity Toolkit admin API,
 * authenticated with the service account in FIREBASE_SERVICE_ACCOUNT_BASE64 (never printed).
 *   node scripts/with-env.mjs .env.project.local -- npx tsx scripts/firebase-auth-domains.ts [add-domain ...]
 */
import { cert } from "firebase-admin/app";

(async () => {
  const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ?? "", "base64").toString("utf8"));
  const project = process.env.FIREBASE_PROJECT_ID!;
  if (sa.project_id !== project) throw new Error("service account / project mismatch");
  const token = (await cert(sa).getAccessToken()).access_token;
  const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const cur = (await (await fetch(base, { headers: h })).json()) as { authorizedDomains?: string[]; error?: { message: string } };
  if (cur.error) throw new Error(cur.error.message);
  const domains = new Set(cur.authorizedDomains ?? []);
  console.log("current:", [...domains].join(", "));
  const add = process.argv.slice(2).filter((d) => !domains.has(d));
  if (!add.length) return console.log("nothing to add");
  const next = [...domains, ...add];
  const res = await fetch(`${base}?updateMask=authorizedDomains`, { method: "PATCH", headers: h, body: JSON.stringify({ authorizedDomains: next }) });
  const out = (await res.json()) as { authorizedDomains?: string[]; error?: { message: string } };
  if (!res.ok) throw new Error(out.error?.message ?? `HTTP ${res.status}`);
  console.log("updated:", (out.authorizedDomains ?? []).join(", "));
})().catch((e) => {
  console.error("failed:", (e as Error).message);
  process.exit(1);
});
