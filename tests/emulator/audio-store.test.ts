import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { AUDIO_CHUNK_BYTES, FirestoreChunkAudioStore } from "@/server/speech/audioStore";

const onEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

describe.skipIf(!onEmulator)("FirestoreChunkAudioStore (opt-in production audio without a new plan)", () => {
  let app: App;
  let db: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: "demo-bridgemun-audio" }, "audio-store-test");
    db = getFirestore(app);
  });
  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  it("round-trips multi-chunk audio byte-exactly and refuses unsafe ids", async () => {
    const store = new FirestoreChunkAudioStore(db);
    const bytes = new Uint8Array(AUDIO_CHUNK_BYTES * 2 + 12345).map((_, i) => (i * 31) % 256);
    await store.put("forumA", "a123", bytes, "audio/mpeg");
    const got = await store.get("forumA", "a123");
    expect(got?.mime).toBe("audio/mpeg");
    expect(got?.bytes.byteLength).toBe(bytes.byteLength);
    expect(Buffer.compare(Buffer.from(got!.bytes), Buffer.from(bytes))).toBe(0);
    expect((await db.collection("forums/forumA/audio/a123/chunks").get()).size).toBe(3);
    expect(await store.get("forumA", "missing")).toBeNull();
    expect(await store.get("../x", "a123")).toBeNull();
    await expect(store.put("forumA", "bad/id", bytes, "audio/mpeg")).rejects.toThrow();
  });
});
