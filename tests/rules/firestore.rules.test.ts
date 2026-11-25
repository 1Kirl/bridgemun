import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { addDoc, collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!onEmulator)("firestore.rules (emulator) — server-only writes", () => {
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
      await setDoc(doc(db, `forums/${F}`), { title: "t", ownerUid: "owner", joinCode: "ABC234", status: "lobby" });
      await setDoc(doc(db, `forums/${F}/members/owner`), { uid: "owner", countryCode: "us" });
      await setDoc(doc(db, `forums/${F}/members/alice`), { uid: "alice", countryCode: "fr" });
      await setDoc(doc(db, `forums/${F}/engine/public`), { state: {} });
      await setDoc(doc(db, `forums/${F}/engineState/current`), { state: {} });
      await setDoc(doc(db, `forums/${F}/record/000000001`), { text: "x" });
      await setDoc(doc(db, `joinCodes/ABC234`), { forumId: F });
    });
  });

  const as = (u: string | null) => (u ? env.authenticatedContext(u).firestore() : env.unauthenticatedContext().firestore());

  it("forum, projection and record: members read; non-members and anonymous cannot", async () => {
    await assertSucceeds(getDoc(doc(as("alice"), `forums/${F}`)));
    await assertSucceeds(getDoc(doc(as("alice"), `forums/${F}/engine/public`)));
    await assertSucceeds(getDoc(doc(as("alice"), `forums/${F}/record/000000001`)));
    await assertFails(getDoc(doc(as("bob"), `forums/${F}`)));
    await assertFails(getDoc(doc(as(null), `forums/${F}`)));
    await assertFails(getDoc(doc(as("bob"), `forums/${F}/engine/public`)));
  });

  it("no client writes anywhere under forums (incl. the owner)", async () => {
    await assertFails(addDoc(collection(as("bob"), "forums"), { title: "x", ownerUid: "bob" }));
    await assertFails(updateDoc(doc(as("owner"), `forums/${F}`), { status: "closed" }));
    await assertFails(setDoc(doc(as("alice"), `forums/${F}/members/alice`), { uid: "alice", countryCode: "us" }));
    await assertFails(setDoc(doc(as("bob"), `forums/${F}/members/bob`), { uid: "bob", countryCode: "gb" }));
    await assertFails(setDoc(doc(as("owner"), `forums/${F}/engine/public`), { state: {} }));
    await assertFails(setDoc(doc(as("alice"), `forums/${F}/record/x`), { text: "forged" }));
    // removed legacy collections stay closed
    await assertFails(addDoc(collection(as("alice"), `forums/${F}/speeches`), { userId: "alice", text: "x" }));
    await assertFails(addDoc(collection(as("alice"), `forums/${F}/participants`), { userId: "alice" }));
    await assertFails(setDoc(doc(as("alice"), `forums/${F}/votes/alice`), { userId: "alice", choice: "yes" }));
  });

  it("private engine state, join codes and usage are unreadable", async () => {
    await assertFails(getDoc(doc(as("owner"), `forums/${F}/engineState/current`)));
    await assertFails(getDoc(doc(as("alice"), `joinCodes/ABC234`)));
    await assertFails(getDoc(doc(as("owner"), `forums/${F}/usage/x`)));
  });

  it("a user can list only their own memberships", async () => {
    await assertSucceeds(getDocs(query(collectionGroup(as("alice"), "members"), where("uid", "==", "alice"))));
    await assertFails(getDocs(query(collectionGroup(as("alice"), "members"), where("uid", "==", "owner"))));
  });

  it("users: only own profile", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "users/alice"), { displayName: "A" }));
    await assertFails(setDoc(doc(as("alice"), "users/bob"), { displayName: "B" }));
  });
});
