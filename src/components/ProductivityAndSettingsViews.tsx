import { FormEvent, useState } from "react"
import {
  TaskItem,
  USER_COLLECTIONS,
  UserFinancialSnapshot,
} from "../domain/types"
import { AuthenticatedUser } from "../services/authService"
import {
  clearUiFirebaseConfig,
  getFirebaseRuntime,
  readSavedUiFirebaseConfig,
  resetFirebaseRuntimeCache,
  saveUiFirebaseConfig,
} from "../services/firebaseClient"
import {
  createUniqueId,
  defaultRepository,
} from "../services/phenaxisRepository"
import { QuickAddTab } from "./ActionModals"
import { Icon, ugxAbs } from "./Icons"

export function ProductivityPage({
  uid,
  page,
  snapshot,
  toggleTask,
  onOpenQuickAdd,
}: {
  uid: string
  page: string
  snapshot: UserFinancialSnapshot
  toggleTask: (task: TaskItem) => void
  onOpenQuickAdd: (tab: QuickAddTab) => void
}) {
  const [projName, setProjName] = useState("")
  const [projScope, setProjScope] = useState("")
  const [projAmount, setProjAmount] = useState("")
  const [projDue, setProjDue] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [projSourceId, setProjSourceId] = useState(
    snapshot.incomeSources[0]?.id ?? "",
  )

  const addProject = async (e: FormEvent) => {
    e.preventDefault()
    if (!projName.trim()) return
    const nowIso = new Date().toISOString()
    await defaultRepository.saveEntity(uid, "projects", {
      id: createUniqueId("proj"),
      ownerUid: uid,
      name: projName.trim(),
      clientOrScope: projScope.trim() || "Personal / Client Milestone",
      status: "active",
      budgetOrContractAmount: Math.max(0, Math.round(Number(projAmount) || 0)),
      dueDate: projDue,
      incomeSourceId: projSourceId || null,
      color: "indigo",
      notes: "",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    setProjName("")
    setProjScope("")
    setProjAmount("")
  }

  const deleteTask = async (taskId: string) => {
    await defaultRepository.deleteEntity(uid, "tasks", taskId)
  }

  const deleteEvent = async (eventId: string) => {
    await defaultRepository.deleteEntity(uid, "calendar_events", eventId)
  }

  const toggleProjectStatus = async (projId: string) => {
    const target = snapshot.projects.find((p) => p.id === projId)
    if (!target) return
    await defaultRepository.saveEntity(uid, "projects", {
      ...target,
      status: target.status === "completed" ? "active" : "completed",
      updatedAt: new Date().toISOString(),
    })
  }

  if (page === "Projects") {
    return (
      <div className="page-content">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Create Client, Ministry, or Personal Project</h2>
              <p>
                Saved under <code>users/{uid}/projects</code>
              </p>
            </div>
          </div>
          <form
            className="inline-grid-form"
            style={{ marginTop: 12 }}
            onSubmit={addProject}
          >
            <input
              required
              placeholder="Project title (e.g. Fintech Portal Redesign)"
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
            />
            <input
              placeholder="Client or ministry scope"
              value={projScope}
              onChange={(e) => setProjScope(e.target.value)}
            />
            <input
              type="number"
              min={0}
              placeholder="Contract / budget UGX"
              value={projAmount}
              onChange={(e) => setProjAmount(e.target.value)}
            />
            <button type="submit" className="quick-add">
              <Icon name="plus" size={16} /> Add Project
            </button>
          </form>
        </div>

        {snapshot.projects.length === 0 ? (
          <div className="card empty-state">
            <p>No projects created yet — add your first milestone project above.</p>
          </div>
        ) : (
          <div className="fund-grid">
            {snapshot.projects.map((p) => (
              <div className="card fund-card" key={p.id}>
                <div className={`fund-icon ${p.color}`}>
                  <Icon name="folder" />
                </div>
                <h3>{p.name}</h3>
                <span className="status">
                  <i /> {p.status.toUpperCase()} · {p.clientOrScope}
                </span>
                <div className="fund-balance">
                  <span>Contract / target value</span>
                  <strong>{ugxAbs(p.budgetOrContractAmount)}</strong>
                </div>
                <div className="fund-stats">
                  <span>
                    Target date<b>{p.dueDate}</b>
                  </span>
                  <span>
                    Linked stream
                    <b>
                      {snapshot.incomeSources.find(
                        (s) => s.id === p.incomeSourceId,
                      )?.name ?? "General"}
                    </b>
                  </span>
                </div>
                <button
                  type="button"
                  className="outline-btn"
                  onClick={() => toggleProjectStatus(p.id)}
                >
                  {p.status === "completed"
                    ? "Reopen project"
                    : "Mark completed"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page-content">
      <div className="time-grid">
        <div className="card day-plan">
          <div className="card-head">
            <div>
              <h2>
                {page === "Tasks"
                  ? "Task Priority Queue"
                  : page === "Calendar"
                    ? "Scheduled Commitments"
                    : "Daily Focus & Time Blocks"}
              </h2>
              <p>
                {snapshot.calendarEvents.length} time block(s) ·{" "}
                {snapshot.tasks.filter((t) => !t.done).length} open task(s)
              </p>
            </div>
            <button
              type="button"
              className="outline-btn"
              onClick={() =>
                onOpenQuickAdd(page === "Tasks" ? "Task" : "Event")
              }
            >
              <Icon name="plus" size={16} />{" "}
              {page === "Tasks" ? "Add task" : "Add block"}
            </button>
          </div>

          {page === "Tasks" ? (
            <div className="task-list" style={{ marginTop: 14 }}>
              {snapshot.tasks.length === 0 ? (
                <p className="muted-hint">
                  No tasks captured yet — click Add task above.
                </p>
              ) : (
                snapshot.tasks.map((task) => (
                  <div
                    className={`task ${task.done ? "done" : ""}`}
                    key={task.id}
                  >
                    <button
                      type="button"
                      onClick={() => toggleTask(task)}
                      aria-label="Toggle task"
                    >
                      <span>
                        {task.done && <Icon name="check" size={14} />}
                      </span>
                    </button>
                    <div>
                      <strong>{task.title}</strong>
                      <small>
                        <Icon name="clock" size={13} />
                        {task.meta} · Due {task.dueDate}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => deleteTask(task.id)}
                      aria-label="Delete task"
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="timeline">
              {snapshot.calendarEvents.length === 0 ? (
                <p className="muted-hint">
                  No scheduled blocks yet — click Add block to plan your day.
                </p>
              ) : (
                snapshot.calendarEvents.map((b) => (
                  <div className="time-block" key={b.id}>
                    <span>{b.startTime}</span>
                    <div className={b.color}>
                      <strong>{b.title}</strong>
                      <small>
                        <Icon name="clock" size={13} />
                        {b.durationLabel} · {b.scope} ({b.date})
                      </small>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteEvent(b.id)}
                      aria-label="Remove event"
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="right-stack">
          <div className="card focus-card">
            <span>TASK COMPLETION</span>
            <strong>
              {snapshot.tasks.filter((t) => t.done).length}/
              {snapshot.tasks.length}
            </strong>
            <p>priorities completed</p>
            <div className="progress">
              <i
                style={{
                  width: `${
                    snapshot.tasks.length > 0
                      ? Math.round(
                          (snapshot.tasks.filter((t) => t.done).length /
                            snapshot.tasks.length) *
                            100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
            <small>
              Synchronized under <code>users/{uid}/tasks</code>
            </small>
          </div>

          <div className="card priority-card">
            <div className="card-head">
              <div>
                <h2>Top open priorities</h2>
                <p>Active focus queue</p>
              </div>
            </div>
            {snapshot.tasks
              .filter((t) => !t.done)
              .slice(0, 4)
              .map((t, i) => (
                <div className="mini-priority" key={t.id}>
                  <b>{i + 1}</b>
                  <span>
                    {t.title}
                    <small>
                      {t.priority} · {t.meta}
                    </small>
                  </span>
                  <Icon name="chevron" size={15} />
                </div>
              ))}
            {snapshot.tasks.filter((t) => !t.done).length === 0 && (
              <p className="muted-hint">All current tasks are complete.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SettingsPage({
  user,
  snapshot,
  onSignOut,
}: {
  user: AuthenticatedUser
  snapshot: UserFinancialSnapshot
  onSignOut: () => void
}) {
  const runtime = getFirebaseRuntime()
  const [displayName, setDisplayName] = useState(snapshot.settings.displayName)
  const [tithe, setTithe] = useState(String(snapshot.settings.tithePercent))
  const [thanksgiving, setThanksgiving] = useState(
    String(snapshot.settings.thanksgivingPercent),
  )
  const [seed, setSeed] = useState(String(snapshot.settings.seedPercent))
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const savedCfg = readSavedUiFirebaseConfig()
  const [apiKey, setApiKey] = useState(savedCfg?.apiKey ?? "")
  const [projectId, setProjectId] = useState(savedCfg?.projectId ?? "")
  const [authDomain, setAuthDomain] = useState(savedCfg?.authDomain ?? "")
  const [appId, setAppId] = useState(savedCfg?.appId ?? "")

  const tNum = Math.max(0, Number(tithe) || 0)
  const thNum = Math.max(0, Number(thanksgiving) || 0)
  const sNum = Math.max(0, Number(seed) || 0)
  const totalPct = tNum + thNum + sNum

  const savePreferences = async (e: FormEvent) => {
    e.preventDefault()
    setStatusMsg(null)
    setErrMsg(null)
    try {
      await defaultRepository.updateSettings(user.uid, {
        displayName,
        tithePercent: tNum,
        thanksgivingPercent: thNum,
        seedPercent: sNum,
      })
      setStatusMsg(
        `Saved giving rules (${tNum}% / ${thNum}% / ${sNum}% = ${totalPct}%) to users/${user.uid}/settings/preferences.`,
      )
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Failed to save settings.")
    }
  }

  const saveCloudConfig = (e: FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim() || !projectId.trim()) {
      setErrMsg("API Key and Project ID are required to connect Firebase.")
      return
    }
    saveUiFirebaseConfig({
      apiKey: apiKey.trim(),
      projectId: projectId.trim(),
      authDomain: authDomain.trim() || `${projectId.trim()}.firebaseapp.com`,
      appId: appId.trim(),
    })
    resetFirebaseRuntimeCache()
    window.location.reload()
  }

  return (
    <div className="page-content">
      {statusMsg && <div className="phx-alert success">{statusMsg}</div>}
      {errMsg && <div className="phx-alert error">{errMsg}</div>}

      <div className="dashboard-grid top-grid">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Automatic Giving Allocation Percentages</h2>
              <p>
                Applied automatically whenever eligible personal income is
                recorded
              </p>
            </div>
          </div>

          <form
            className="phx-form"
            style={{ marginTop: 14 }}
            onSubmit={savePreferences}
          >
            <label>
              Workspace Steward Display Name
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>

            <div className="three-col-row">
              <label>
                Tithe (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={tithe}
                  onChange={(e) => setTithe(e.target.value)}
                />
              </label>
              <label>
                Thanksgiving (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={thanksgiving}
                  onChange={(e) => setThanksgiving(e.target.value)}
                />
              </label>
              <label>
                Seed (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
              </label>
            </div>

            <div className="allocation-preview">
              <div className="allocation-preview-head">
                <Icon name="church" size={16} />
                <strong>
                  Sample Calculation on UGX 500,000 Eligible Income ({totalPct}%
                  Total)
                </strong>
              </div>
              <div className="allocation-preview-grid">
                <span>
                  Tithe ({tNum}%)
                  <b>{ugxAbs((500_000 * tNum) / 100)}</b>
                </span>
                <span>
                  Thanksgiving ({thNum}%)
                  <b>{ugxAbs((500_000 * thNum) / 100)}</b>
                </span>
                <span>
                  Seed ({sNum}%)
                  <b>{ugxAbs((500_000 * sNum) / 100)}</b>
                </span>
                <span>
                  Total Reserved
                  <b>{ugxAbs((500_000 * totalPct) / 100)}</b>
                </span>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="outline-btn"
                onClick={() => {
                  setTithe("10")
                  setThanksgiving("5")
                  setSeed("5")
                }}
              >
                Reset to 10% / 5% / 5%
              </button>
              <button type="submit" className="quick-add">
                Save Giving Rules
              </button>
            </div>
          </form>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Authenticated User Isolation & Session</h2>
              <p>Strict UID-scoped paths block cross-user access</p>
            </div>
          </div>

          <div className="phx-subbox" style={{ marginTop: 14 }}>
            <p className="kv-line">
              <span>Signed in as:</span> <strong>{user.email}</strong>
            </p>
            <p className="kv-line">
              <span>Isolated UID:</span> <code>{user.uid}</code>
            </p>
            <p className="kv-line">
              <span>Root Firestore Path:</span>{" "}
              <code>users/{user.uid}/...</code>
            </p>
            <p className="kv-line">
              <span>Active Persistence:</span>{" "}
              <strong>
                {runtime.mode === "firebase_cloud"
                  ? `Cloud Firestore (${runtime.projectId})`
                  : "Local Isolated Multi-User Vault"}
              </strong>
            </p>
          </div>

          <div style={{ marginTop: 12 }}>
            <small className="block-sub" style={{ marginBottom: 6 }}>
              14 Isolated User Collections:
            </small>
            <div className="collection-pills">
              {USER_COLLECTIONS.map((col) => (
                <code key={col}>{col}</code>
              ))}
            </div>
          </div>

          <div className="modal-actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="outline-btn danger-outline"
              onClick={onSignOut}
            >
              <Icon name="logout" size={16} /> Sign out / Switch user
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Firebase Spark Cloud Connection</h2>
            <p>
              Provide your Firebase Web App credentials via{" "}
              <code>.env.local</code> or connect directly below
            </p>
          </div>
        </div>
        <form
          className="inline-grid-form"
          style={{ marginTop: 12 }}
          onSubmit={saveCloudConfig}
        >
          <input
            placeholder="VITE_FIREBASE_API_KEY"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <input
            placeholder="VITE_FIREBASE_PROJECT_ID"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          />
          <input
            placeholder="Auth Domain / App ID (optional)"
            value={authDomain || appId}
            onChange={(e) => {
              setAuthDomain(e.target.value)
              setAppId(e.target.value)
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="submit" className="quick-add">
              Connect Firebase
            </button>
            {savedCfg && (
              <button
                type="button"
                className="outline-btn"
                onClick={() => {
                  clearUiFirebaseConfig()
                  resetFirebaseRuntimeCache()
                  window.location.reload()
                }}
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

