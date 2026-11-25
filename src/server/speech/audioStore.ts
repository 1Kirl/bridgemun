import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where generated AI speech audio lives. Clients fetch it through an authenticated, membership-checked
 * route, never directly.
 *  - LocalFsAudioStore: development/testing (files under .data/audio, git-ignored)
 *  - Firebase Storage: production option, NOT implemented yet (needs the Blaze plan decision, D8)
 */
export interface AudioStore {
  readonly name: string;
  put(forumId: string, audioId: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(forumId: string, audioId: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
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
