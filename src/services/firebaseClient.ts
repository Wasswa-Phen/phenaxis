import { FirebaseApp, FirebaseOptions, getApps, initializeApp } from "firebase/app"
import { Auth, getAuth } from "firebase/auth"
import {
  Firestore,
  initializeFirestore,
  persistentLocalCache,
  getFirestore,
} from "firebase/firestore"

const FIREBASE_CONFIG_STORAGE_KEY = "phenaxis:firebase_web_config_v1"

export interface FirebaseRuntimeState {
  mode: "firebase_cloud" | "local_isolated_vault"
  app: FirebaseApp | null
  auth: Auth | null
  db: Firestore | null
  projectId: string | null
  configSource: "env" | "saved_ui_config" | "none"
}

function readEnvConfig(): FirebaseOptions | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim()
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim()
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim()
  const appId = env.VITE_FIREBASE_APP_ID?.trim()

  if (apiKey && projectId) {
    return {
      apiKey,
      projectId,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      storageBucket:
        env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || `${projectId}.appspot.com`,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || "",
      appId: appId || "",
    }
  }
  return null
}

export function readSavedUiFirebaseConfig(): FirebaseOptions | null {
  if (typeof window === "undefined" || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FirebaseOptions>
    if (parsed.apiKey && parsed.projectId) {
      return {
        apiKey: parsed.apiKey.trim(),
        projectId: parsed.projectId.trim(),
        authDomain:
          parsed.authDomain?.trim() || `${parsed.projectId.trim()}.firebaseapp.com`,
        storageBucket:
          parsed.storageBucket?.trim() || `${parsed.projectId.trim()}.appspot.com`,
        messagingSenderId: parsed.messagingSenderId?.trim() || "",
        appId: parsed.appId?.trim() || "",
      }
    }
  } catch {
    return null
  }
  return null
}

export function saveUiFirebaseConfig(config: FirebaseOptions): void {
  if (typeof window === "undefined" || !window.localStorage) return
  window.localStorage.setItem(
    FIREBASE_CONFIG_STORAGE_KEY,
    JSON.stringify(config),
  )
}

export function clearUiFirebaseConfig(): void {
  if (typeof window === "undefined" || !window.localStorage) return
  window.localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY)
}

let cachedState: FirebaseRuntimeState | null = null

export function getFirebaseRuntime(): FirebaseRuntimeState {
  if (cachedState) return cachedState

  const envCfg = readEnvConfig()
  const uiCfg = envCfg ? null : readSavedUiFirebaseConfig()
  const activeCfg = envCfg || uiCfg
  const configSource = envCfg ? "env" : uiCfg ? "saved_ui_config" : "none"

  if (!activeCfg) {
    cachedState = {
      mode: "local_isolated_vault",
      app: null,
      auth: null,
      db: null,
      projectId: null,
      configSource: "none",
    }
    return cachedState
  }

  try {
    const existing = getApps()
    const app = existing.length > 0 ? existing[0] : initializeApp(activeCfg)
    const auth = getAuth(app)
    let db: Firestore
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache(),
      })
    } catch {
      db = getFirestore(app)
    }

    cachedState = {
      mode: "firebase_cloud",
      app,
      auth,
      db,
      projectId: activeCfg.projectId ?? null,
      configSource,
    }
    return cachedState
  } catch {
    cachedState = {
      mode: "local_isolated_vault",
      app: null,
      auth: null,
      db: null,
      projectId: null,
      configSource: "none",
    }
    return cachedState
  }
}

export function resetFirebaseRuntimeCache(): void {
  cachedState = null
}

