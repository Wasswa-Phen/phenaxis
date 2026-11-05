import { FormEvent, useState } from "react"
import { defaultAuthService } from "../services/authService"
import {
  clearUiFirebaseConfig,
  getFirebaseRuntime,
  isLocalVaultForced,
  readSavedUiFirebaseConfig,
  resetFirebaseRuntimeCache,
  saveUiFirebaseConfig,
  setLocalVaultForced,
} from "../services/firebaseClient"
import { Icon } from "./Icons"

export function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const runtime = getFirebaseRuntime()
  const [tab, setTab] = useState<"signin" | "register" | "cloud">("signin")
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const savedCfg = readSavedUiFirebaseConfig()
  const [apiKey, setApiKey] = useState(savedCfg?.apiKey ?? "")
  const [projectId, setProjectId] = useState(savedCfg?.projectId ?? "")
  const [authDomain, setAuthDomain] = useState(savedCfg?.authDomain ?? "")
  const [appId, setAppId] = useState(savedCfg?.appId ?? "")

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (tab === "register") {
        await defaultAuthService.registerWithEmail({
          email,
          password,
          displayName: displayName || email.split("@")[0],
        })
      } else {
        await defaultAuthService.signInWithEmail({ email, password })
      }
      onAuthenticated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed."
      if (
        msg.includes("auth/configuration-not-found") ||
        msg.includes("auth/operation-not-allowed")
      ) {
        setError(
          `One-time Firebase Console step needed: enable "Email/Password" sign-in at console.firebase.google.com/project/${runtime.projectId || "phenaxis-ug"}/authentication/providers — or tap "Use Instant Device Vault" below to test immediately.`,
        )
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleGoogle = async () => {
    setError(null)
    setBusy(true)
    try {
      await defaultAuthService.signInWithGoogle()
      onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.")
    } finally {
      setBusy(false)
    }
  }

  const handleSaveCloud = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!apiKey.trim() || !projectId.trim()) {
      setError("Firebase API Key and Project ID are required.")
      return
    }
    saveUiFirebaseConfig({
      apiKey: apiKey.trim(),
      projectId: projectId.trim(),
      authDomain: authDomain.trim() || `${projectId.trim()}.firebaseapp.com`,
      appId: appId.trim(),
    })
    resetFirebaseRuntimeCache()
    setInfo("Firebase Cloud configuration saved. Reloading runtime...")
    window.location.reload()
  }

  const handleClearCloud = () => {
    clearUiFirebaseConfig()
    resetFirebaseRuntimeCache()
    window.location.reload()
  }

  return (
    <div className="auth-screen">
      <div className="card auth-card">
        <div className="auth-brand-row">
          <div className="brand" style={{ padding: 0, height: "auto" }}>
            <div className="brand-mark">
              <span />
              <span />
              <span />
            </div>
            <span>PHENAXIS</span>
          </div>
          <span
            className={`phx-badge ${runtime.mode === "firebase_cloud" ? "green" : "indigo"}`}
          >
            <Icon name="lock" size={11} />
            {runtime.mode === "firebase_cloud"
              ? `Cloud Firestore · ${runtime.projectId}`
              : "Isolated User Vault"}
          </span>
        </div>

        <div className="auth-heading">
          <h1>Your Life. One Center.</h1>
          <p>
            Authenticated personal finance, automatic 20% giving engine,
            ring-fenced entrusted funds, and AI financial intelligence.
          </p>
        </div>

        <div className="filter-tabs auth-tabs">
          <button
            type="button"
            className={tab === "signin" ? "active" : ""}
            onClick={() => {
              setTab("signin")
              setError(null)
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={tab === "register" ? "active" : ""}
            onClick={() => {
              setTab("register")
              setError(null)
            }}
          >
            Create account
          </button>
          <button
            type="button"
            className={tab === "cloud" ? "active" : ""}
            onClick={() => {
              setTab("cloud")
              setError(null)
            }}
          >
            Firebase Spark Config
          </button>
        </div>

        {error && (
          <div className="phx-alert error">
            <div>{error}</div>
            {runtime.mode === "firebase_cloud" && (
              <button
                type="button"
                className="inline-link"
                style={{ marginTop: 6, display: "inline-block" }}
                onClick={() => {
                  setLocalVaultForced(true)
                  resetFirebaseRuntimeCache()
                  window.location.reload()
                }}
              >
                Use Instant Device Vault on this phone while Cloud Auth activates →
              </button>
            )}
          </div>
        )}
        {isLocalVaultForced() && (
          <div className="phx-alert success">
            Running in Instant Device Vault mode.{" "}
            <button
              type="button"
              className="inline-link"
              onClick={() => {
                setLocalVaultForced(false)
                resetFirebaseRuntimeCache()
                window.location.reload()
              }}
            >
              Switch back to Firebase Cloud (phenaxis-ug) →
            </button>
          </div>
        )}
        {info && <div className="phx-alert success">{info}</div>}

        {tab === "cloud" ? (
          <form className="phx-form" onSubmit={handleSaveCloud}>
            <div className="notice">
              <Icon name="shield" size={16} />
              <span>
                Connect your Firebase Spark project (or set{" "}
                <code>VITE_FIREBASE_*</code> in <code>.env.local</code>). All
                records isolate strictly under <code>users/&#123;uid&#125;/</code>.
              </span>
            </div>
            <label>
              Firebase API Key
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
              />
            </label>
            <div className="form-row">
              <label>
                Project ID
                <input
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="phenaxis-finance"
                />
              </label>
              <label>
                App ID (optional)
                <input
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="1:123456:web:abc"
                />
              </label>
            </div>
            <label>
              Auth Domain (optional)
              <input
                value={authDomain}
                onChange={(e) => setAuthDomain(e.target.value)}
                placeholder="phenaxis-finance.firebaseapp.com"
              />
            </label>
            <div className="modal-actions">
              {savedCfg && (
                <button
                  type="button"
                  className="outline-btn"
                  onClick={handleClearCloud}
                >
                  Disconnect custom config
                </button>
              )}
              <button type="submit" className="quick-add">
                Save & Connect Cloud
              </button>
            </div>
          </form>
        ) : (
          <form className="phx-form" onSubmit={handleAuthSubmit}>
            {tab === "register" && (
              <label>
                Full name
                <input
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Andrew K."
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="steward@phenaxis.ug"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </label>
            <button
              type="submit"
              className="quick-add auth-submit"
              disabled={busy}
            >
              <Icon name="lock" size={15} />
              <span>
                {busy
                  ? "Authenticating..."
                  : tab === "register"
                    ? "Create isolated workspace"
                    : "Sign in to workspace"}
              </span>
            </button>

            {runtime.mode === "firebase_cloud" && (
              <button
                type="button"
                className="outline-btn auth-google"
                onClick={handleGoogle}
                disabled={busy}
              >
                Continue with Google
              </button>
            )}

            <p className="auth-footnote">
              {tab === "signin" ? (
                <>
                  New to PHENAXIS?{" "}
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => setTab("register")}
                  >
                    Create an authenticated account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => setTab("signin")}
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

