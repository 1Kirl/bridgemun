#!/usr/bin/env node
/**
 * Runs a command with variables from an explicit env file loaded FIRST into process.env.
 * Next.js never overrides variables that already exist in process.env, so this file wins over
 * .env.development / .env.local — but only for this one command.
 *
 *   node scripts/with-env.mjs .env.project.local -- next dev
 *
 * Values are never printed. The file must be git-ignored (.env.* is ignored by .gitignore).
 */
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const [file, sep, ...cmd] = process.argv.slice(2);
if (!file || sep !== "--" || cmd.length === 0) {
  console.error("usage: node scripts/with-env.mjs <env-file> -- <command...>");
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`${file} not found. Copy .env.project.example to ${file} and fill it in.`);
  process.exit(2);
}
let count = 0;
for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 1) continue;
  const key = line.slice(0, i).trim();
  let val = line.slice(i + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  if (val === "") continue; // empty entries do not override defaults
  process.env[key] = val;
  count++;
}
console.error(`[with-env] loaded ${count} variable(s) from ${file} (values not shown)`);
const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
