import { describe, expect, it } from "vitest";
import { parseFirebasePublicConfig } from "@/lib/env/firebasePublicConfig";
import { resolveAdminConnection } from "@/server/firebaseAdmin";

const base = {
  apiKey: "k",
  authDomain: "x.firebaseapp.com",
  storageBucket: "x.appspot.com",
  appId: "app",
};

describe("public Firebase config guard (no fallback)", () => {
  it("rejects missing mode", () => {
    expect(() => parseFirebasePublicConfig({ ...base, projectId: "demo-a" })).toThrow(/MODE/);
  });
  it("rejects missing fields instead of falling back", () => {
    expect(() => parseFirebasePublicConfig({ mode: "project", projectId: "my-proj" })).toThrow(/Missing/);
  });
  it("refuses the previous developer's project in any mode", () => {
    expect(() => parseFirebasePublicConfig({ ...base, mode: "project", projectId: "model-un-d1704" })).toThrow(
      /previous developer/,
    );
  });
  it("emulator mode requires demo- project id", () => {
    expect(() => parseFirebasePublicConfig({ ...base, mode: "emulator", projectId: "my-proj" })).toThrow(/demo-/);
    expect(parseFirebasePublicConfig({ ...base, mode: "emulator", projectId: "demo-x" }).emulatorHost).toBe("127.0.0.1");
  });
  it("project mode refuses demo- ids", () => {
    expect(() => parseFirebasePublicConfig({ ...base, mode: "project", projectId: "demo-x" })).toThrow();
  });
});

describe("admin connection guard", () => {
  const pubEmu = parseFirebasePublicConfig({ ...base, mode: "emulator", projectId: "demo-x" });
  const pubProj = parseFirebasePublicConfig({ ...base, mode: "project", projectId: "my-proj" });
  const sa = (project_id: string) =>
    Buffer.from(JSON.stringify({ project_id, client_email: "a@b", private_key: "pk" })).toString("base64");

  it("requires server project id", () => {
    expect(() => resolveAdminConnection(pubEmu, {})).toThrow(/FIREBASE_PROJECT_ID/);
  });
  it("refuses client/server project mismatch", () => {
    expect(() => resolveAdminConnection(pubEmu, { FIREBASE_PROJECT_ID: "demo-y" })).toThrow(/differs/);
  });
  it("emulator mode uses emulator hosts", () => {
    const c = resolveAdminConnection(pubEmu, { FIREBASE_PROJECT_ID: "demo-x" });
    expect(c.kind).toBe("emulator");
  });
  it("project mode requires a service account for the same project", () => {
    expect(() => resolveAdminConnection(pubProj, { FIREBASE_PROJECT_ID: "my-proj" })).toThrow(/SERVICE_ACCOUNT/);
    expect(() =>
      resolveAdminConnection(pubProj, { FIREBASE_PROJECT_ID: "my-proj", FIREBASE_SERVICE_ACCOUNT_BASE64: sa("other") }),
    ).toThrow(/belongs to "other"/);
    const ok = resolveAdminConnection(pubProj, {
      FIREBASE_PROJECT_ID: "my-proj",
      FIREBASE_SERVICE_ACCOUNT_BASE64: sa("my-proj"),
    });
    expect(ok.kind).toBe("service-account");
  });
});
