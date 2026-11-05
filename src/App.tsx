import { useEffect, useMemo, useState } from "react"
import {
  PayAllocationModal,
  QuickAddModal,
  QuickAddTab,
  TransactionAuditModal,
} from "./components/ActionModals"
import { AuthGate } from "./components/AuthGate"
import { DashboardView } from "./components/DashboardView"
import {
  AccountsPage,
  BudgetsPage,
  EntrustedFundsPage,
  FinanceCommandPage,
  ReportsPage,
  TransactionsPage,
} from "./components/FinanceViews"
import { Icon, IconName } from "./components/Icons"
import {
  ProductivityPage,
  SettingsPage,
} from "./components/ProductivityAndSettingsViews"
import {
  GivingAllocation,
  LedgerTransaction,
  TaskItem,
  UserFinancialSnapshot,
} from "./domain/types"
import {
  AuthenticatedUser,
  defaultAuthService,
} from "./services/authService"
import { defaultRepository } from "./services/phenaxisRepository"

const navGroups = [
  {
    label: "Overview",
    items: [{ name: "Dashboard", icon: "grid" as IconName }],
  },
  {
    label: "Money",
    items: [
      { name: "Finance", icon: "wallet" as IconName },
      { name: "Transactions", icon: "swap" as IconName },
      { name: "Accounts", icon: "bank" as IconName },
      { name: "Entrusted Funds", icon: "shield" as IconName },
      { name: "Budgets", icon: "target" as IconName },
      { name: "Reports", icon: "chart" as IconName },
    ],
  },
  {
    label: "Productivity",
    items: [
      { name: "My Day", icon: "sun" as IconName },
      { name: "Calendar", icon: "calendar" as IconName },
      { name: "Tasks", icon: "check" as IconName },
      { name: "Projects", icon: "folder" as IconName },
    ],
  },
]

const pageDescriptions: Record<string, string> = {
  Finance:
    "Income streams, automatic 20% giving engine, savings goals, and AI financial intelligence.",
  Transactions:
    "Complete, idempotency-protected, auditable record of all money movements.",
  Accounts:
    "Manage cash, bank, Mobile Money, and business accounts with derived balances.",
  "Entrusted Funds":
    "Keep entrusted money separate, transparent, and strictly ring-fenced.",
  Budgets: "Give every shilling a purpose before you spend it.",
  Reports:
    "Reconciled monthly income summaries, giving ledgers, and source performance.",
  "My Day": "Plan today with clarity, focus, and realistic time blocks.",
  Calendar: "See your schedule, deadlines, and commitments together.",
  Tasks: "Capture, prioritize, and complete what matters most.",
  Projects: "Move meaningful work forward, one milestone at a time.",
  Settings:
    "Configure automatic giving percentages, workspace isolation, and Firebase Cloud.",
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "PX"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function Sidebar({
  active,
  setActive,
  open,
  close,
  user,
  displayName,
  openTasksCount,
  unpaidGivingCount,
  onSignOut,
}: {
  active: string
  setActive: (x: string) => void
  open: boolean
  close: () => void
  user: AuthenticatedUser
  displayName: string
  openTasksCount: number
  unpaidGivingCount: number
  onSignOut: () => void
}) {
  return (
    <>
      {open && (
        <button
          type="button"
          className="sidebar-overlay"
          onClick={close}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <img
            src="/Logo.png"
            alt="PHENAXIS Logo"
            className="brand-logo"
          />
          <span>PHENAXIS</span>
        </div>
        <nav>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.name}
                  className={`nav-item ${active === item.name ? "active" : ""}`}
                  onClick={() => {
                    setActive(item.name)
                    close()
                  }}
                >
                  <Icon name={item.icon} />
                  <span>{item.name}</span>
                  {item.name === "Tasks" && openTasksCount > 0 && (
                    <b>{openTasksCount}</b>
                  )}
                  {item.name === "Finance" && unpaidGivingCount > 0 && (
                    <b>{unpaidGivingCount}</b>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            type="button"
            className={`nav-item ${active === "Settings" ? "active" : ""}`}
            onClick={() => {
              setActive("Settings")
              close()
            }}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          <div className="profile">
            <div className="avatar">{getInitials(displayName)}</div>
            <div>
              <strong>{displayName}</strong>
              <span>{user.email}</span>
            </div>
            <button
              type="button"
              className="icon-button"
              style={{ width: 34, height: 34 }}
              title="Sign out / Switch user"
              onClick={onSignOut}
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

function Header({
  searchQuery,
  setSearchQuery,
  onSearchFocusNavigate,
  unpaidObligationsCount,
  onNotificationsClick,
  onQuickAdd,
  onMenu,
}: {
  searchQuery: string
  setSearchQuery: (q: string) => void
  onSearchFocusNavigate: () => void
  unpaidObligationsCount: number
  onNotificationsClick: () => void
  onQuickAdd: () => void
  onMenu: () => void
}) {
  return (
    <header>
      <button
        type="button"
        className="icon-button mobile-menu"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Icon name="menu" />
      </button>
      <div className="header-title">
        <span>Your Life. One Center.</span>
      </div>
      <label className="search">
        <Icon name="search" size={17} />
        <input
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            if (e.target.value.trim()) onSearchFocusNavigate()
          }}
          placeholder="Search ledger, sources, IDs..."
        />
        <kbd>⌘ K</kbd>
      </label>
      <button
        type="button"
        className="icon-button notification"
        aria-label="Giving obligations & alerts"
        title={
          unpaidObligationsCount > 0
            ? `${unpaidObligationsCount} unpaid giving obligation(s)`
            : "All obligations clear"
        }
        onClick={onNotificationsClick}
      >
        <Icon name="bell" />
        {unpaidObligationsCount > 0 && <i />}
      </button>
      <button type="button" className="quick-add" onClick={onQuickAdd}>
        <Icon name="plus" size={17} />
        <span>Quick Add</span>
      </button>
    </header>
  )
}

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [snapshot, setSnapshot] = useState<UserFinancialSnapshot | null>(null)

  const [active, setActive] = useState("Dashboard")
  const [sidebar, setSidebar] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const [quickAddTab, setQuickAddTab] = useState<QuickAddTab | null>(null)
  const [payingAllocation, setPayingAllocation] =
    useState<GivingAllocation | null>(null)
  const [auditingTransaction, setAuditingTransaction] =
    useState<LedgerTransaction | null>(null)

  useEffect(() => {
    const unsub = defaultAuthService.subscribe((authUser) => {
      defaultRepository.setAuthenticatedUidResolver(() => authUser?.uid ?? null)
      setUser(authUser)
      setAuthReady(true)
      if (!authUser) {
        setSnapshot(null)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    let unsubSnap: (() => void) | null = null

    const boot = async () => {
      await defaultRepository.ensureUserInitialized(user.uid, user.displayName)
      if (cancelled) return
      unsubSnap = defaultRepository.subscribe(user.uid, (snap) => {
        if (!cancelled) setSnapshot(snap)
      })
    }

    boot()

    return () => {
      cancelled = true
      if (unsubSnap) unsubSnap()
    }
  }, [user])

  const pageSubtitle = useMemo(() => pageDescriptions[active], [active])

  if (!authReady) {
    return (
      <div className="auth-screen">
        <div className="card auth-card" style={{ textAlign: "center" }}>
          <p>Loading PHENAXIS workspace...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <AuthGate
        onAuthenticated={() => {
          const u = defaultAuthService.getCurrentUser()
          setUser(u)
        }}
      />
    )
  }

  if (!snapshot) {
    return (
      <div className="auth-screen">
        <div className="card auth-card" style={{ textAlign: "center" }}>
          <p>Synchronizing authenticated ledger for {user.email}...</p>
        </div>
      </div>
    )
  }

  const displayName = snapshot.settings.displayName || user.displayName
  const openTasksCount = snapshot.tasks.filter((t) => !t.done).length
  const unpaidGivingCount = snapshot.allocations.filter(
    (a) => a.status === "unpaid",
  ).length

  const toggleTask = async (task: TaskItem) => {
    await defaultRepository.saveEntity(user.uid, "tasks", {
      ...task,
      done: !task.done,
      updatedAt: new Date().toISOString(),
    })
  }

  const defaultTabForActivePage = (): QuickAddTab => {
    if (active === "Entrusted Funds") return "Entrusted"
    if (active === "Accounts") return "Transfer"
    if (active === "Tasks") return "Task"
    if (active === "Calendar" || active === "My Day") return "Event"
    return "Income"
  }

  const handleSignOut = async () => {
    await defaultAuthService.signOut()
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        setActive={setActive}
        open={sidebar}
        close={() => setSidebar(false)}
        user={user}
        displayName={displayName}
        openTasksCount={openTasksCount}
        unpaidGivingCount={unpaidGivingCount}
        onSignOut={handleSignOut}
      />

      <main>
        <Header
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearchFocusNavigate={() => {
            if (active !== "Transactions") setActive("Transactions")
          }}
          unpaidObligationsCount={unpaidGivingCount}
          onNotificationsClick={() => setActive("Finance")}
          onQuickAdd={() => setQuickAddTab(defaultTabForActivePage())}
          onMenu={() => setSidebar(true)}
        />

        <div className="content">
          {active !== "Dashboard" && (
            <section className="page-heading">
              <div>
                <button type="button" onClick={() => setActive("Dashboard")}>
                  Workspace
                </button>
                <span>/</span>
                <b>{active}</b>
                <h1>{active}</h1>
                <p>{pageSubtitle}</p>
              </div>
              <button
                type="button"
                className="quick-add"
                onClick={() => setQuickAddTab(defaultTabForActivePage())}
              >
                <Icon name="plus" size={17} />
                <span>
                  {active === "Entrusted Funds"
                    ? "New entrusted entry"
                    : active === "Accounts"
                      ? "Transfer funds"
                      : active === "Tasks"
                        ? "Add task"
                        : active === "Calendar" || active === "My Day"
                          ? "Add event"
                          : "Record entry"}
                </span>
              </button>
            </section>
          )}

          {active === "Dashboard" && (
            <DashboardView
              snapshot={snapshot}
              displayName={displayName}
              toggleTask={toggleTask}
              setActive={setActive}
              onInspectTransaction={(tx) => setAuditingTransaction(tx)}
              onOpenQuickAdd={(tab) => setQuickAddTab(tab ?? "Income")}
            />
          )}

          {active === "Finance" && (
            <FinanceCommandPage
              uid={user.uid}
              snapshot={snapshot}
              onOpenQuickAdd={(tab) => setQuickAddTab(tab)}
              onPayAllocation={(alloc) => setPayingAllocation(alloc)}
              onInspectTransaction={(tx) => setAuditingTransaction(tx)}
            />
          )}

          {active === "Transactions" && (
            <TransactionsPage
              snapshot={snapshot}
              searchQuery={searchQuery}
              onOpenQuickAdd={(tab) => setQuickAddTab(tab)}
              onInspectTransaction={(tx) => setAuditingTransaction(tx)}
            />
          )}

          {active === "Accounts" && (
            <AccountsPage
              uid={user.uid}
              snapshot={snapshot}
              onOpenQuickAdd={(tab) => setQuickAddTab(tab)}
            />
          )}

          {active === "Entrusted Funds" && (
            <EntrustedFundsPage
              snapshot={snapshot}
              onOpenQuickAdd={(tab) => setQuickAddTab(tab)}
              onInspectTransaction={(tx) => setAuditingTransaction(tx)}
            />
          )}

          {active === "Budgets" && (
            <BudgetsPage uid={user.uid} snapshot={snapshot} />
          )}

          {active === "Reports" && (
            <ReportsPage uid={user.uid} snapshot={snapshot} />
          )}

          {["My Day", "Calendar", "Tasks", "Projects"].includes(active) && (
            <ProductivityPage
              uid={user.uid}
              page={active}
              snapshot={snapshot}
              toggleTask={toggleTask}
              onOpenQuickAdd={(tab) => setQuickAddTab(tab)}
            />
          )}

          {active === "Settings" && (
            <SettingsPage
              user={user}
              snapshot={snapshot}
              onSignOut={handleSignOut}
            />
          )}
        </div>
      </main>

      {quickAddTab && (
        <QuickAddModal
          uid={user.uid}
          snapshot={snapshot}
          initialTab={quickAddTab}
          close={() => setQuickAddTab(null)}
        />
      )}

      {payingAllocation && (
        <PayAllocationModal
          uid={user.uid}
          allocation={payingAllocation}
          snapshot={snapshot}
          close={() => setPayingAllocation(null)}
        />
      )}

      {auditingTransaction && (
        <TransactionAuditModal
          uid={user.uid}
          transaction={auditingTransaction}
          snapshot={snapshot}
          close={() => setAuditingTransaction(null)}
        />
      )}
    </div>
  )
}
