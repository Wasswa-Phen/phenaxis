import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth"
import { getFirebaseRuntime } from "./firebaseClient"
import {
  createUniqueId,
  defaultRepository,
  KeyValuePersistence,
} from "./phenaxisRepository"

export interface AuthenticatedUser {
  uid: string
  email: string
  displayName: string
  provider: "firebase_cloud" | "local_isolated_vault"
}

interface StoredVaultAccount {
  uid: string
  email: string
  displayName: string
  passwordDigest: string
  createdAt: string
}

const VAULT_USERS_KEY = "phenaxis:auth:vault_accounts_v1"
const VAULT_SESSION_KEY = "phenaxis:auth:active_session_v1"

function simpleDigest(email: string, password: string): string {
  const input = `${email.toLowerCase().trim()}::phenaxis_salt::${password}`
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`
}

export class PhenaxisAuthService {
  private persistence: KeyValuePersistence
  private forceLocalVault: boolean
  private currentUser: AuthenticatedUser | null = null
  private listeners = new Set<(user: AuthenticatedUser | null) => void>()

  constructor(options?: {
    persistence?: KeyValuePersistence
    forceLocalVault?: boolean
  }) {
    this.persistence =
      options?.persistence ??
      (typeof window !== "undefined" && window.localStorage
        ? window.localStorage
        : {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          })
    this.forceLocalVault = options?.forceLocalVault ?? false
  }

  public getCurrentUser(): AuthenticatedUser | null {
    return this.currentUser
  }

  private setCurrentUser(user: AuthenticatedUser | null): void {
    this.currentUser = user
    for (const cb of this.listeners) {
      cb(user)
    }
  }

  private readVaultUsers(): StoredVaultAccount[] {
    const raw = this.persistence.getItem(VAULT_USERS_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as StoredVaultAccount[]) : []
    } catch {
      return []
    }
  }

  private writeVaultUsers(users: StoredVaultAccount[]): void {
    this.persistence.setItem(VAULT_USERS_KEY, JSON.stringify(users))
  }

  private restoreVaultSession(): AuthenticatedUser | null {
    const raw = this.persistence.getItem(VAULT_SESSION_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as AuthenticatedUser
      if (parsed?.uid && parsed?.email) {
        return parsed
      }
    } catch {
      return null
    }
    return null
  }

  public subscribe(
    callback: (user: AuthenticatedUser | null) => void,
  ): () => void {
    this.listeners.add(callback)
    const runtime = getFirebaseRuntime()

    if (!this.forceLocalVault && runtime.mode === "firebase_cloud" && runtime.auth) {
      const unsub = onAuthStateChanged(runtime.auth, (fbUser) => {
        if (fbUser) {
          const authUser: AuthenticatedUser = {
            uid: fbUser.uid,
            email: fbUser.email || "user@phenaxis.app",
            displayName:
              fbUser.displayName ||
              fbUser.email?.split("@")[0] ||
              "PHENAXIS Steward",
            provider: "firebase_cloud",
          }
          this.setCurrentUser(authUser)
        } else {
          this.setCurrentUser(null)
        }
      })
      return () => {
        this.listeners.delete(callback)
        unsub()
      }
    }

    const restored = this.restoreVaultSession()
    this.currentUser = restored
    callback(restored)
    return () => {
      this.listeners.delete(callback)
    }
  }

  public async registerWithEmail(params: {
    email: string
    password: string
    displayName: string
  }): Promise<AuthenticatedUser> {
    const email = params.email.trim().toLowerCase()
    const displayName = params.displayName.trim() || email.split("@")[0]
    if (!email || !email.includes("@")) {
      throw new Error("Please enter a valid email address.")
    }
    if (params.password.length < 6) {
      throw new Error("Password must be at least 6 characters.")
    }

    const runtime = getFirebaseRuntime()
    if (!this.forceLocalVault && runtime.mode === "firebase_cloud" && runtime.auth) {
      const cred = await createUserWithEmailAndPassword(
        runtime.auth,
        email,
        params.password,
      )
      await updateProfile(cred.user, { displayName })
      const user: AuthenticatedUser = {
        uid: cred.user.uid,
        email: cred.user.email || email,
        displayName,
        provider: "firebase_cloud",
      }
      this.setCurrentUser(user)
      return user
    }

    const users = this.readVaultUsers()
    if (users.some((u) => u.email === email)) {
      throw new Error("An account with this email already exists. Please sign in.")
    }

    const uid = createUniqueId("uid")
    const account: StoredVaultAccount = {
      uid,
      email,
      displayName,
      passwordDigest: simpleDigest(email, params.password),
      createdAt: new Date().toISOString(),
    }
    this.writeVaultUsers([...users, account])

    const sessionUser: AuthenticatedUser = {
      uid,
      email,
      displayName,
      provider: "local_isolated_vault",
    }
    this.persistence.setItem(VAULT_SESSION_KEY, JSON.stringify(sessionUser))
    this.setCurrentUser(sessionUser)
    return sessionUser
  }

  public async signInWithEmail(params: {
    email: string
    password: string
  }): Promise<AuthenticatedUser> {
    const email = params.email.trim().toLowerCase()
    const runtime = getFirebaseRuntime()

    if (!this.forceLocalVault && runtime.mode === "firebase_cloud" && runtime.auth) {
      const cred = await signInWithEmailAndPassword(
        runtime.auth,
        email,
        params.password,
      )
      const user: AuthenticatedUser = {
        uid: cred.user.uid,
        email: cred.user.email || email,
        displayName:
          cred.user.displayName || email.split("@")[0] || "PHENAXIS Steward",
        provider: "firebase_cloud",
      }
      this.setCurrentUser(user)
      return user
    }

    const users = this.readVaultUsers()
    const match = users.find((u) => u.email === email)
    if (!match) {
      throw new Error("No account found for this email. Create an account first.")
    }
    if (match.passwordDigest !== simpleDigest(email, params.password)) {
      throw new Error("Incorrect password.")
    }

    const sessionUser: AuthenticatedUser = {
      uid: match.uid,
      email: match.email,
      displayName: match.displayName,
      provider: "local_isolated_vault",
    }
    this.persistence.setItem(VAULT_SESSION_KEY, JSON.stringify(sessionUser))
    this.setCurrentUser(sessionUser)
    return sessionUser
  }

  public async signInWithGoogle(): Promise<AuthenticatedUser> {
    const runtime = getFirebaseRuntime()
    if (!this.forceLocalVault && runtime.mode === "firebase_cloud" && runtime.auth) {
      const provider = new GoogleAuthProvider()
      const cred = await signInWithPopup(runtime.auth, provider)
      const user: AuthenticatedUser = {
        uid: cred.user.uid,
        email: cred.user.email || "user@phenaxis.app",
        displayName:
          cred.user.displayName ||
          cred.user.email?.split("@")[0] ||
          "PHENAXIS Steward",
        provider: "firebase_cloud",
      }
      this.setCurrentUser(user)
      return user
    }
    throw new Error(
      "Connect your Firebase Spark project first to enable Google OAuth popup sign-in, or sign in with Email & Password below.",
    )
  }

  public async signOut(): Promise<void> {
    const runtime = getFirebaseRuntime()
    if (!this.forceLocalVault && runtime.mode === "firebase_cloud" && runtime.auth) {
      await firebaseSignOut(runtime.auth)
    }
    this.persistence.removeItem(VAULT_SESSION_KEY)
    this.setCurrentUser(null)
  }
}

export const defaultAuthService = new PhenaxisAuthService()

defaultRepository.setAuthenticatedUidResolver(
  () => defaultAuthService.getCurrentUser()?.uid ?? null,
)

