/**
 * Validated public Firebase configuration shared by client and server.
 *
 * There is deliberately NO fallback: if the environment is incomplete the app
 * fails loudly instead of silently connecting to some other Firebase project.
 * NEXT_PUBLIC_* variables must be referenced literally so Next.js can inline them.
 */

/** Projects owned by the previous developer. The new app must never connect to them. */
export const LEGACY_FIREBASE_PROJECT_IDS = ["model-un-d1704"] as const;

export type FirebaseMode = "emulator" | "project";

export type FirebasePublicConfig = {
  mode: FirebaseMode;
  projectId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  appId: string;
  messagingSenderId?: string;
  emulatorHost: string;
};

export class FirebaseConfigError extends Error {
  constructor(message: string) {
    super(`[BridgeMUN config] ${message}`);
    this.name = "FirebaseConfigError";
  }
}

type RawPublicEnv = {
  mode?: string;
  projectId?: string;
  apiKey?: string;
  authDomain?: string;
  storageBucket?: string;
  appId?: string;
  messagingSenderId?: string;
  emulatorHost?: string;
};

export function readRawPublicEnv(): RawPublicEnv {
  return {
    mode: process.env.NEXT_PUBLIC_FIREBASE_MODE,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    emulatorHost: process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST,
  };
}

/** Pure validation, unit-tested. */
export function parseFirebasePublicConfig(raw: RawPublicEnv): FirebasePublicConfig {
  const mode = raw.mode;
  if (mode !== "emulator" && mode !== "project") {
    throw new FirebaseConfigError(
      `NEXT_PUBLIC_FIREBASE_MODE must be "emulator" or "project" (got ${JSON.stringify(mode)}).`,
    );
  }
  const required: Array<keyof RawPublicEnv> = ["projectId", "apiKey", "authDomain", "storageBucket", "appId"];
  const missing = required.filter((k) => !raw[k] || !String(raw[k]).trim());
  if (missing.length > 0) {
    throw new FirebaseConfigError(`Missing public Firebase settings: ${missing.join(", ")}.`);
  }
  const projectId = String(raw.projectId).trim();
  if ((LEGACY_FIREBASE_PROJECT_IDS as readonly string[]).includes(projectId)) {
    throw new FirebaseConfigError(
      `Project "${projectId}" belongs to the previous developer and must not be used. Configure your own Firebase project.`,
    );
  }
  if (mode === "emulator" && !projectId.startsWith("demo-")) {
    throw new FirebaseConfigError(
      `Emulator mode requires a "demo-" project id so no request can reach a real project (got "${projectId}").`,
    );
  }
  if (mode === "project" && projectId.startsWith("demo-")) {
    throw new FirebaseConfigError(`Project mode cannot use the emulator-only project id "${projectId}".`);
  }
  if (mode === "project") {
    // Guards against half-filled real config silently inheriting emulator placeholders from .env.development.
    const leaked = (["apiKey", "authDomain", "storageBucket", "appId"] as const).filter((k) => String(raw[k]).includes("demo-"));
    if (leaked.length) {
      throw new FirebaseConfigError(`Project mode still has emulator placeholder values for: ${leaked.join(", ")}. Fill in the real web-app config.`);
    }
  }
  return {
    mode,
    projectId,
    apiKey: String(raw.apiKey),
    authDomain: String(raw.authDomain),
    storageBucket: String(raw.storageBucket),
    appId: String(raw.appId),
    messagingSenderId: raw.messagingSenderId || undefined,
    emulatorHost: raw.emulatorHost?.trim() || "127.0.0.1",
  };
}

/** Emulator ports (defaults match firebase.json; NEXT_PUBLIC_EMU_*_PORT lets a second local project use other ports). */
const port = (v: string | undefined, d: number) => Number(v) || d;
export const EMULATOR_PORTS = {
  auth: port(process.env.NEXT_PUBLIC_EMU_AUTH_PORT, 9099),
  firestore: port(process.env.NEXT_PUBLIC_EMU_FIRESTORE_PORT, 8080),
  storage: port(process.env.NEXT_PUBLIC_EMU_STORAGE_PORT, 9199),
} as const;
