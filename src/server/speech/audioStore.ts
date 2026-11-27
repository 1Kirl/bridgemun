import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import type { Bucket } from "@google-cloud/storage";

/**
 * Where generated AI speech audio lives. Clients fetch it through an authenticated, membership-checked
 * route, never directly.
 *  - LocalFsAudioStore: development/testing (files under .data/audio, git-ignored)
 *  - FirestoreChunkAudioStore: opt-in production option without a new plan (AUDIO_STORE=firestore);
 *    bytes are split into ≤ 700 KB base64-free Blob chunks under forums/{id}/audio/{audioId}/chunks.
 *    Uses the project's existing Firestore quota; NOT enabled by default (owner decision).
 *  - StorageAudioStore: production (AUDIO_STORE=storage). Private objects in the project's default Firebase Storage
 *    bucket under forums/{forumId}/audio/{audioId}; served only through the members-only route (no public URLs,
 *    no download tokens). Deleted when the forum closes; a 7-day bucket lifecycle rule is the backstop.
 */
export interface AudioStore {
  readonly name: string;
  put(forumId: string, audioId: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(forumId: string, audioId: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Removes every audio object of a forum (called when the forum closes, and by test cleanup). */
  deleteForum?(forumId: string): Promise<number>;
}

const safe = (s: string) => /^[A-Za-z0-9_-]{1,80}$/.test(s);

export class LocalFsAudioStore implements AudioStore {
  readonly name = "local-fs";
  constructor(private root = path.join(process.cwd(), ".data", "audio")) {}
  async put(forumId: string, audioId: string, bytes: Uint8Array, mime: string) {
    if (!safe(forumId) || !safe(audioId)) throw new Error("bad id");
    const dir = path.join(this.root, forumId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${audioId}.bin`), bytes);
    await writeFile(path.join(dir, `${audioId}.mime`), mime);
  }
  async get(forumId: string, audioId: string) {
    if (!safe(forumId) || !safe(audioId)) return null;
    try {
      const dir = path.join(this.root, forumId);
      const [bytes, mime] = await Promise.all([readFile(path.join(dir, `${audioId}.bin`)), readFile(path.join(dir, `${audioId}.mime`), "utf8")]);
      return { bytes: new Uint8Array(bytes), mime };
    } catch {
      return null;
    }
  }
}

export class StorageAudioStore implements AudioStore {
  readonly name = "firebase-storage";
  constructor(private bucket: Bucket) {}
  private file(forumId: string, audioId: string) {
    return this.bucket.file(`forums/${forumId}/audio/${audioId}`);
  }
  async put(forumId: string, audioId: string, bytes: Uint8Array, mime: string) {
    if (!safe(forumId) || !safe(audioId)) throw new Error("bad id");
    if (bytes.byteLength > MAX_AUDIO_STORE_BYTES) throw new Error("audio too large");
    await this.file(forumId, audioId).save(Buffer.from(bytes), {
      resumable: false,
      contentType: mime,
      metadata: { cacheControl: "private, max-age=3600", metadata: { forumId, createdAtMs: String(Date.now()) } },
    });
  }
  async get(forumId: string, audioId: string) {
    if (!safe(forumId) || !safe(audioId)) return null;
    const f = this.file(forumId, audioId);
    try {
      const [[buf], [meta]] = await Promise.all([f.download(), f.getMetadata()]);
      return { bytes: new Uint8Array(buf), mime: meta.contentType || "audio/mpeg" };
    } catch (e) {
      if ((e as { code?: number }).code === 404) return null;
      throw e;
    }
  }
  async deleteForum(forumId: string) {
    if (!safe(forumId)) return 0;
    const [files] = await this.bucket.getFiles({ prefix: `forums/${forumId}/audio/` });
    await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
    return files.length;
  }
}

export class MemoryAudioStore implements AudioStore {
  readonly name = "memory";
  items = new Map<string, { bytes: Uint8Array; mime: string }>();
  async put(forumId: string, audioId: string, bytes: Uint8Array, mime: string) {
    this.items.set(`${forumId}/${audioId}`, { bytes, mime });
  }
  async get(forumId: string, audioId: string) {
    return this.items.get(`${forumId}/${audioId}`) ?? null;
  }
}

/** Firestore documents are limited to 1 MiB; chunks stay well below. */
export const AUDIO_CHUNK_BYTES = 700 * 1024;
export const MAX_AUDIO_STORE_BYTES = 8 * 1024 * 1024;

export class FirestoreChunkAudioStore implements AudioStore {
  readonly name = "firestore-chunks";
  constructor(private db: Firestore) {}
  async put(forumId: string, audioId: string, bytes: Uint8Array, mime: string) {
    if (!safe(forumId) || !safe(audioId)) throw new Error("bad id");
    if (bytes.byteLength > MAX_AUDIO_STORE_BYTES) throw new Error("audio too large");
    const base = this.db.doc(`forums/${forumId}/audio/${audioId}`);
    const n = Math.max(1, Math.ceil(bytes.byteLength / AUDIO_CHUNK_BYTES));
    const batch = this.db.batch();
    for (let i = 0; i < n; i++) {
      batch.set(base.collection("chunks").doc(String(i).padStart(3, "0")), { i, data: Buffer.from(bytes.subarray(i * AUDIO_CHUNK_BYTES, (i + 1) * AUDIO_CHUNK_BYTES)) });
    }
    batch.set(base, { mime, bytes: bytes.byteLength, chunks: n, createdAtMs: Date.now() }); // written last in the same batch
    await batch.commit();
  }
  async get(forumId: string, audioId: string) {
    if (!safe(forumId) || !safe(audioId)) return null;
    const base = this.db.doc(`forums/${forumId}/audio/${audioId}`);
    const meta = await base.get();
    if (!meta.exists) return null;
    const m = meta.data() as { mime: string; chunks: number; bytes: number };
    const snap = await base.collection("chunks").orderBy("i").get();
    if (snap.size !== m.chunks) return null;
    const out = Buffer.concat(snap.docs.map((d) => Buffer.from(d.data().data as Uint8Array)));
    return out.byteLength === m.bytes ? { bytes: new Uint8Array(out), mime: m.mime } : null;
  }
}
