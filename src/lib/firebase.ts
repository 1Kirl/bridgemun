import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import {
  EMULATOR_PORTS,
  parseFirebasePublicConfig,
  readRawPublicEnv,
} from "@/lib/env/firebasePublicConfig";

// Throws (no fallback) when the environment is incomplete or points at a legacy project.
export const firebasePublicConfig = parseFirebasePublicConfig(readRawPublicEnv());

const app = getApps().length
  ? getApp()
  : initializeApp({
      apiKey: firebasePublicConfig.apiKey,
      authDomain: firebasePublicConfig.authDomain,
      projectId: firebasePublicConfig.projectId,
      storageBucket: firebasePublicConfig.storageBucket,
      messagingSenderId: firebasePublicConfig.messagingSenderId,
      appId: firebasePublicConfig.appId,
    });

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

declare global {
  // Survives Next.js fast refresh so emulators are connected exactly once.
  var __bridgemunEmulatorsConnected: boolean | undefined;
}

if (firebasePublicConfig.mode === "emulator" && !globalThis.__bridgemunEmulatorsConnected) {
  const host = firebasePublicConfig.emulatorHost;
  connectAuthEmulator(auth, `http://${host}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, EMULATOR_PORTS.firestore);
  connectStorageEmulator(storage, host, EMULATOR_PORTS.storage);
  globalThis.__bridgemunEmulatorsConnected = true;
}

export default app;
