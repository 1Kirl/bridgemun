import "server-only";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  EMULATOR_PORTS,
  FirebaseConfigError,
  parseFirebasePublicConfig,
  readRawPublicEnv,
  type FirebasePublicConfig,
} from "@/lib/env/firebasePublicConfig";

type ServiceAccountShape = { project_id?: string; client_email?: string; private_key?: string };

/** Pure: decide how the Admin SDK connects, refusing client/server project mismatch. Unit-tested. */
export function resolveAdminConnection(
  pub: FirebasePublicConfig,
  serverEnv: { FIREBASE_PROJECT_ID?: string; FIREBASE_SERVICE_ACCOUNT_BASE64?: string },
):
  | { kind: "emulator"; projectId: string; firestoreHost: string; authHost: string; storageHost: string }
  | { kind: "service-account"; projectId: string; serviceAccount: Required<ServiceAccountShape> } {
  const serverProjectId = serverEnv.FIREBASE_PROJECT_ID?.trim();
  if (!serverProjectId) throw new FirebaseConfigError("FIREBASE_PROJECT_ID is not set.");
  if (serverProjectId !== pub.projectId) {
    throw new FirebaseConfigError(
      `Server FIREBASE_PROJECT_ID ("${serverProjectId}") differs from NEXT_PUBLIC_FIREBASE_PROJECT_ID ("${pub.projectId}").`,
    );
  }
  if (pub.mode === "emulator") {
    const h = pub.emulatorHost;
    return {
      kind: "emulator",
      projectId: pub.projectId,
      firestoreHost: `${h}:${EMULATOR_PORTS.firestore}`,
      authHost: `${h}:${EMULATOR_PORTS.auth}`,
      storageHost: `${h}:${EMULATOR_PORTS.storage}`,
    };
  }
  const b64 = serverEnv.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (!b64) throw new FirebaseConfigError("FIREBASE_SERVICE_ACCOUNT_BASE64 is not set (project mode).");
  let sa: ServiceAccountShape;
  try {
    sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccountShape;
  } catch {
    throw new FirebaseConfigError("FIREBASE_SERVICE_ACCOUNT_BASE64 is not valid base64-encoded JSON.");
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new FirebaseConfigError("Service account JSON lacks project_id/client_email/private_key.");
  }
  if (sa.project_id !== pub.projectId) {
    throw new FirebaseConfigError(
      `Service account belongs to "${sa.project_id}" but the app is configured for "${pub.projectId}".`,
    );
  }
  return {
    kind: "service-account",
    projectId: pub.projectId,
    serviceAccount: { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key },
  };
}

let cached: App | null = null;

export function getAdminApp(): App {
  if (cached) return cached;
  if (getApps().length) {
    cached = getApp();
    return cached;
  }
  const pub = parseFirebasePublicConfig(readRawPublicEnv());
  const conn = resolveAdminConnection(pub, {
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_SERVICE_ACCOUNT_BASE64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
  });
  if (conn.kind === "emulator") {
    // The Admin SDK reads these variables; setting them here keeps emulator wiring in one place.
    process.env.FIRESTORE_EMULATOR_HOST ??= conn.firestoreHost;
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= conn.authHost;
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= conn.storageHost;
    cached = initializeApp({ projectId: conn.projectId, storageBucket: pub.storageBucket });
  } else {
    cached = initializeApp({
      projectId: conn.projectId,
      storageBucket: pub.storageBucket,
      credential: cert({
        projectId: conn.serviceAccount.project_id,
        clientEmail: conn.serviceAccount.client_email,
        privateKey: conn.serviceAccount.private_key,
      }),
    });
  }
  return cached;
}

export const adminDb = () => getFirestore(getAdminApp());
export const adminAuth = () => getAuth(getAdminApp());
