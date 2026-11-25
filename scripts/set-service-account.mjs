#!/usr/bin/env node
/**
 * Puts a Firebase service-account key into .env.project.local as FIREBASE_SERVICE_ACCOUNT_BASE64
 * WITHOUT printing it. Verifies that the key belongs to the expected project.
 *
 *   node scripts/set-service-account.mjs ~/secrets/bridgemun-firebase-adminsdk.json [bridgemun]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";

const [rawPath, expected = "bridgemun"] = process.argv.slice(2);
if (!rawPath) {
  console.error("usage: node scripts/set-service-account.mjs <service-account.json> [projectId]");
  process.exit(2);
}
const file = rawPath.replace(/^~(?=\/)/, os.homedir());
let sa;
try {
  sa = JSON.parse(readFileSync(file, "utf8"));
} catch {
  console.error("Could not read a JSON file at that path.");
  process.exit(1);
}
if (sa.type !== "service_account" || !sa.private_key || !sa.client_email) {
  console.error("That file is not a service-account key.");
  process.exit(1);
}
if (sa.project_id !== expected) {
  console.error(`Key belongs to project "${sa.project_id}", expected "${expected}". Nothing written.`);
  process.exit(1);
}
const target = ".env.project.local";
if (!existsSync(target)) {
  console.error(`${target} not found (copy .env.project.example first).`);
  process.exit(1);
}
const b64 = Buffer.from(JSON.stringify(sa)).toString("base64");
const lines = readFileSync(target, "utf8").split(/\r?\n/);
let replaced = false;
const out = lines.map((l) => (l.startsWith("FIREBASE_SERVICE_ACCOUNT_BASE64=") ? ((replaced = true), `FIREBASE_SERVICE_ACCOUNT_BASE64=${b64}`) : l));
if (!replaced) out.push(`FIREBASE_SERVICE_ACCOUNT_BASE64=${b64}`);
writeFileSync(target, out.join("\n"), { mode: 0o600 });
console.log(`OK: service account for project "${sa.project_id}" (${sa.client_email.split("@")[0]}@…) stored in ${target}. Value not shown.`);
