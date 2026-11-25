import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection } from "firebase/firestore";

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!onEmulator)("firestore.rules (emulator)", () => {
  let env: RulesTestEnvironment;
  const F = "forum1";

  beforeAll(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
    env = await initializeTestEnvironment({
      projectId: "demo-bridgemun-rules",
      firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
    });
  });
  afterAll(async () => env?.cleanup());

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `forums/${F}`), { topic: "t", createdBy: "owner", status: "active" });
      await setDoc(doc(db, `forums/${F}/members/alice`), { countryCode: "fr" });
      await setDoc(doc(db, `forums/${F}/engine/state`), { phase: "LOBBY" });
      await setDoc(doc(db, `forums/${F}/participants/p1`), { userId: "alice", country: { code: "fr" }, online: true });
      await setDoc(doc(db, `joinCodes/ABC123`), { forumId: F });
    });
  });

  const as = (uid: string | null) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());

  it("only the creator can update a forum; nobody can delete; engine fields are immutable", async () => {
    await assertFails(updateDoc(doc(as("mallory"), `forums/${F}`), { status: "closed" }));
    await assertSucceeds(updateDoc(doc(as("owner"), `forums/${F}`), { votingOpen: true }));
    await assertFails(updateDoc(doc(as("owner"), `forums/${F}`), { engine: { phase: "X" } }));
    await assertFails(updateDoc(doc(as("owner"), `forums/${F}`), { createdBy: "mallory" }));
    await assertFails(deleteDoc(doc(as("owner"), `forums/${F}`)));
  });

  it("forum create requires createdBy == caller and no engine fields", async () => {
    const db = as("bob");
    await assertSucceeds(addDoc(collection(db, "forums"), { topic: "x", createdBy: "bob", status: "active" }));
    await assertFails(addDoc(collection(db, "forums"), { topic: "x", createdBy: "alice", status: "active" }));
    await assertFails(addDoc(collection(db, "forums"), { topic: "x", createdBy: "bob", status: "active", joinLocked: false }));
  });

  it("speeches cannot impersonate other users or AI delegates", async () => {
    const db = as("bob");
    await assertSucceeds(addDoc(collection(db, `forums/${F}/speeches`), { userId: "bob", text: "hi" }));
    await assertFails(addDoc(collection(db, `forums/${F}/speeches`), { userId: "alice", text: "forged" }));
    await assertFails(addDoc(collection(db, `forums/${F}/speeches`), { userId: "ai:fr", sourceType: "ai", text: "forged ai" }));
    await assertSucceeds(
      addDoc(collection(as("owner"), `forums/${F}/speeches`), { userId: "ai:fr", sourceType: "ai", text: "legacy publish" }),
    );
  });

  it("participants cannot change their country after joining", async () => {
    await assertSucceeds(updateDoc(doc(as("alice"), `forums/${F}/participants/p1`), { online: false }));
    await assertFails(updateDoc(doc(as("alice"), `forums/${F}/participants/p1`), { country: { code: "us" } }));
    await assertFails(updateDoc(doc(as("bob"), `forums/${F}/participants/p1`), { online: false }));
  });

  it("aiSuggestions and motions are owner-only", async () => {
    await assertFails(addDoc(collection(as("bob"), `forums/${F}/aiSuggestions`), { x: 1 }));
    await assertFails(addDoc(collection(as("bob"), `forums/${F}/motions`), { title: "m" }));
    await assertSucceeds(addDoc(collection(as("owner"), `forums/${F}/motions`), { title: "m", status: "open" }));
  });

  it("server-owned collections: members can read, nobody can write", async () => {
    await assertSucceeds(getDoc(doc(as("alice"), `forums/${F}/engine/state`)));
    await assertFails(getDoc(doc(as("bob"), `forums/${F}/engine/state`)));
    await assertFails(setDoc(doc(as("alice"), `forums/${F}/engine/state`), { phase: "CLOSED" }));
    await assertFails(setDoc(doc(as("alice"), `forums/${F}/members/alice`), { countryCode: "us" }));
    await assertFails(setDoc(doc(as("bob"), `forums/${F}/members/bob`), { countryCode: "us" }));
    await assertFails(setDoc(doc(as("alice"), `forums/${F}/seats/us`), { uid: "alice" }));
    await assertFails(getDoc(doc(as("alice"), `joinCodes/ABC123`)));
    await assertFails(getDoc(doc(as("owner"), `forums/${F}/usage/legacyAi`)));
    await assertFails(getDoc(doc(as("alice"), `forums/${F}/engineState/current`)));
  });

  it("admin_countries is read-only for clients", async () => {
    await assertFails(setDoc(doc(as("alice"), `admin_countries/fr`), { politicalAlignment: "x" }));
  });
});
