import { useMemo, useState } from "react"
import { analyzeFinancialPosition } from "../domain/aiAccountant"
import {
  buildMonthlyIncomeSummary,
  deriveBalances,
  toMonthKey,
} from "../domain/ledgerEngine"
import {
  LedgerTransaction,
  TaskItem,
  UserFinancialSnapshot,
} from "../domain/types"
import { Icon, IconName, ugx, ugxAbs } from "./Icons"

function getRecentMonths(count: number, anchorMonthKey: string): string[] {
  const [yStr, mStr] = anchorMonthKey.split("-")
  let year = Number(yStr) || new Date().getFullYear()
  let month = Number(mStr) || new Date().getMonth() + 1

  const result: string[] = []
  for (let i = 0; i < count; i++) {
    result.unshift(`${year}-${String(month).padStart(2, "0")}`)
    month -= 1
    if (month <= 0) {
      month = 12
      year -= 1
    }
  }
  return result
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

export function DynamicCashFlowChart({
  snapshot,
  periodMonths = 6,
  anchorMonthKey,
}: {
  snapshot: UserFinancialSnapshot
  periodMonths?: number
  anchorMonthKey: string
}) {
  const months = useMemo(
    () => getRecentMonths(periodMonths, anchorMonthKey),
    [periodMonths, anchorMonthKey],
  )

  const series = useMemo(() => {
    return months.map((mk) => {
      let income = 0
      let expenses = 0
      for (const tx of snapshot.transactions) {
        if (tx.status === "voided" || tx.monthKey !== mk) continue
        if (tx.kind === "personal_income" || tx.kind === "owner_withdrawal") {
          income += tx.amount
        } else if (
          tx.kind === "personal_expense" ||
          tx.kind === "allocation_payment"
        ) {
          expenses += tx.amount
        }
      }
      const mIdx = Math.max(0, Math.min(11, Number(mk.slice(5, 7)) - 1))
      return { monthKey: mk, label: SHORT_MONTHS[mIdx], income, expenses }
    })
  }, [months, snapshot.transactions])

  const maxVal = useMemo(() => {
    const rawMax = Math.max(
      1_000_000,
      ...series.map((s) => Math.max(s.income, s.expenses)),
    )
    return Math.ceil(rawMax / 500_000) * 500_000
  }, [series])

  const buildPoints = (key: "income" | "expenses") =>
    series.map((item, idx) => {
      const x =
        series.length <= 1 ? 320 : Math.round((idx / (series.length - 1)) * 640)
      const ratio = maxVal > 0 ? item[key] / maxVal : 0
      const y = Math.round(210 - ratio * 185)
      return { x, y }
    })

  const incPts = buildPoints("income")
  const expPts = buildPoints("expenses")

  const toLinePath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ")

  const incLine = toLinePath(incPts)
  const incFill = `${incLine} L640 220 L0 220 Z`
  const expLine = toLinePath(expPts)

  const yTicks = [1, 0.8, 0.6, 0.4, 0.2, 0].map((f) => {
    const val = maxVal * f
    if (val === 0) return "0"
    return val >= 1_000_000
      ? `${(val / 1_000_000).toFixed(val % 1_000_000 === 0 ? 0 : 1)}M`
      : `${Math.round(val / 1000)}K`
  })

  return (
    <div className="chart-wrap">
      <div className="y-labels">
        {yTicks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
      <svg
        className="line-chart"
        viewBox="0 0 640 225"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4F46E5" stopOpacity=".18" />
            <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[10, 50, 90, 130, 170, 210].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="640"
            y2={y}
            stroke="#eef0f4"
            strokeWidth="1"
          />
        ))}
        <path d={incFill} fill="url(#incomeFill)" />
        <path
          d={incLine}
          fill="none"
          stroke="#4F46E5"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={expLine}
          fill="none"
          stroke="#F59E0B"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="7 6"
        />
        {incPts.map((pt, idx) => (
          <circle
            key={idx}
            cx={pt.x}
            cy={pt.y}
            r="4"
            fill="#fff"
            stroke="#4F46E5"
            strokeWidth="2.5"
          />
        ))}
      </svg>
      <div className="x-labels">
        {series.map((s) => (
          <span key={s.monthKey}>{s.label}</span>
        ))}
      </div>
    </div>
  )
}

export function TransactionRow({
  tx,
  onSelect,
}: {
  tx: LedgerTransaction
  onSelect: (tx: LedgerTransaction) => void
}) {
  const iconAndColor = (): { icon: IconName; color: string } => {
    if (tx.kind === "personal_income" || tx.kind === "owner_withdrawal") {
      return { icon: "briefcase", color: "indigo" }
    }
    if (tx.kind === "allocation_payment") {
      return { icon: "church", color: "emerald" }
    }
    if (tx.kind === "entrusted_inflow" || tx.kind === "entrusted_outflow") {
      return { icon: "shield", color: "violet" }
    }
    if (tx.kind === "transfer") {
      return { icon: "swap", color: "blue" }
    }
    if (tx.kind === "business_revenue" || tx.kind === "project_cost") {
      return { icon: "briefcase", color: "amber" }
    }
    if (tx.kind === "savings_deposit" || tx.kind === "savings_withdrawal") {
      return { icon: "target", color: "emerald" }
    }
    return { icon: "wallet", color: "amber" }
  }

  const { icon, color } = iconAndColor()
  const isPositive = tx.direction === "in"
  const prefix =
    tx.direction === "earmark" ? "⇄" : isPositive ? "+" : "−"

  const metaParts: string[] = []
  if (tx.kind === "personal_income" || tx.kind === "owner_withdrawal") {
    metaParts.push(tx.incomeSourceName || "Personal Income")
  } else if (tx.kind === "business_revenue") {
    metaParts.push("Business Gross Revenue")
  } else if (tx.kind === "project_cost") {
    metaParts.push("Project Cost")
  } else if (tx.kind === "allocation_payment") {
    metaParts.push("Giving Settlement")
  } else if (tx.kind === "transfer") {
    metaParts.push("Linked Transfer")
  } else if (tx.kind === "non_income_inflow") {
    metaParts.push((tx.incomeType || "Non-income").replace(/_/g, " "))
  } else if (tx.categoryName) {
    metaParts.push(tx.categoryName)
  }
  metaParts.push(tx.accountName)
  if (tx.status !== "active") {
    metaParts.push(tx.status.toUpperCase())
  }

  return (
    <div
      className={`transaction clickable-tx ${tx.status === "voided" ? "tx-voided" : ""}`}
      onClick={() => onSelect(tx)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect(tx)}
    >
      <div className={`transaction-icon ${color}`}>
        <Icon name={icon} />
      </div>
      <div className="transaction-name">
        <strong>{tx.title}</strong>
        <span>{metaParts.join(" · ")}</span>
      </div>
      <span className="transaction-date">{tx.date}</span>
      <strong className={isPositive ? "positive" : ""}>
        {prefix} {ugxAbs(tx.amount)}
      </strong>
    </div>
  )
}

export function StatCard({
  icon,
  tone,
  label,
  amount,
  change,
  changeLabel,
  inverse = false,
  onClick,
}: {
  icon: IconName
  tone: string
  label: string
  amount: string
  change: string
  changeLabel: string
  inverse?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={`stat-card ${onClick ? "clickable-card" : ""}`}
      onClick={onClick}
    >
      <div className={`stat-icon ${tone}`}>
        <Icon name={icon} />
      </div>
      <div className="stat-label">
        <span>{label}</span>
        <button type="button" aria-label={`View ${label}`}>
          <Icon name="more" size={18} />
        </button>
      </div>
      <strong className="stat-amount">{amount}</strong>
      <div className={`stat-change ${inverse ? "negative" : ""}`}>
        <span>
          <Icon name="arrowUp" size={12} />
          {change}
        </span>
        {changeLabel}
      </div>
    </div>
  )
}

export function FiveBalancesIntegrityStrip({
  snapshot,
  onPayObligationsClick,
}: {
  snapshot: UserFinancialSnapshot
  onPayObligationsClick?: () => void
}) {
  const b = useMemo(() => deriveBalances(snapshot), [snapshot])
  const unpaidCount = snapshot.allocations.filter(
    (a) => a.status === "unpaid",
  ).length

  return (
    <div className="integrity-strip">
      <div className="integrity-cell">
        <span>1. Actual Account Balance</span>
        <strong>{ugx(b.actualAccountBalance)}</strong>
        <small>Personal bank, MoMo & cash</small>
      </div>
      <div className="integrity-cell">
        <span>2. Reserved Obligations</span>
        <strong className="tone-indigo">{ugxAbs(b.reservedObligations)}</strong>
        <small>
          {unpaidCount} unpaid giving{" "}
          {unpaidCount > 0 && onPayObligationsClick && (
            <button
              type="button"
              className="inline-link"
              onClick={onPayObligationsClick}
            >
              · Pay now
            </button>
          )}
        </small>
      </div>
      <div className="integrity-cell highlight">
        <span>3. Unallocated Available</span>
        <strong
          className={
            b.unallocatedAvailableMoney < 0 ? "tone-danger" : "tone-green"
          }
        >
          {ugx(b.unallocatedAvailableMoney)}
        </strong>
        <small>Actual − Reserved − Savings</small>
      </div>
      <div className="integrity-cell">
        <span>4. Savings Balances</span>
        <strong>{ugxAbs(b.savingsBalances)}</strong>
        <small>{snapshot.savingsGoals.length} active goal(s)</small>
      </div>
      <div className="integrity-cell">
        <span>5. Entrusted Balances</span>
        <strong className="tone-violet">{ugxAbs(b.entrustedBalances)}</strong>
        <small>Ring-fenced custodial funds</small>
      </div>
    </div>
  )
}

export function DashboardView({
  snapshot,
  displayName,
  toggleTask,
  setActive,
  onInspectTransaction,
  onOpenQuickAdd,
}: {
  snapshot: UserFinancialSnapshot
  displayName: string
  toggleTask: (task: TaskItem) => void
  setActive: (page: string) => void
  onInspectTransaction: (tx: LedgerTransaction) => void
  onOpenQuickAdd: (tab?: "Income" | "Expense" | "Transfer" | "Entrusted") => void
}) {
  const [period, setPeriod] = useState("6 months")
  const [txFilter, setTxFilter] = useState("All")

  const todayIso = new Date().toISOString().slice(0, 10)
  const currentMonthKey = toMonthKey(todayIso)

  const balances = useMemo(() => deriveBalances(snapshot), [snapshot])
  const monthlyIncome = useMemo(
    () => buildMonthlyIncomeSummary(snapshot, currentMonthKey),
    [snapshot, currentMonthKey],
  )
  const aiAnalysis = useMemo(
    () => analyzeFinancialPosition(snapshot, todayIso),
    [snapshot, todayIso],
  )

  const monthlyExpenses = useMemo(() => {
    let personalExp = 0
    let givingPaid = 0
    for (const tx of snapshot.transactions) {
      if (tx.status === "voided" || tx.monthKey !== currentMonthKey) continue
      if (tx.kind === "personal_expense") personalExp += tx.amount
      else if (tx.kind === "allocation_payment") givingPaid += tx.amount
    }
    return { personalExp, givingPaid, total: personalExp + givingPaid }
  }, [snapshot.transactions, currentMonthKey])

  const budgetRows = useMemo(() => {
    return snapshot.budgets.slice(0, 4).map((b) => {
      const spent = snapshot.transactions
        .filter(
          (tx) =>
            tx.status !== "voided" &&
            tx.monthKey === currentMonthKey &&
            tx.kind === "personal_expense" &&
            (tx.categoryId === b.categoryId ||
              tx.categoryName === b.categoryName),
        )
        .reduce((s, tx) => s + tx.amount, 0)
      return { ...b, spent }
    })
  }, [snapshot.budgets, snapshot.transactions, currentMonthKey])

  const totalBudgetLimit = budgetRows.reduce((s, b) => s + b.limitAmount, 0)
  const totalBudgetSpent = budgetRows.reduce((s, b) => s + b.spent, 0)
  const budgetPct =
    totalBudgetLimit > 0
      ? Math.min(100, Math.round((totalBudgetSpent / totalBudgetLimit) * 100))
      : 0

  const activeTxs = useMemo(
    () => snapshot.transactions.filter((t) => t.status !== "voided"),
    [snapshot.transactions],
  )

  const visibleTx = useMemo(() => {
    const filtered =
      txFilter === "All"
        ? activeTxs
        : txFilter === "Income"
          ? activeTxs.filter(
              (t) =>
                t.kind === "personal_income" || t.kind === "owner_withdrawal",
            )
          : activeTxs.filter(
              (t) =>
                t.kind === "personal_expense" ||
                t.kind === "allocation_payment",
            )
    return filtered.slice(0, 6)
  }, [activeTxs, txFilter])

  const formattedDate = useMemo(() => {
    try {
      return new Date().toLocaleDateString("en-UG", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    } catch {
      return todayIso
    }
  }, [todayIso])

  const periodCount =
    period === "3 months" ? 3 : period === "12 months" ? 12 : 6
  const netMonthCashFlow =
    monthlyIncome.totalEligiblePersonalIncome - monthlyExpenses.total

  return (
    <>
      <section className="welcome-row">
        <div>
          <h1>Good day, {displayName.split(" ")[0]}</h1>
          <p>{aiAnalysis.headline}</p>
        </div>
        <div className="date-pill">
          <Icon name="calendar" size={16} /> {formattedDate}
        </div>
      </section>

      <section className="stat-grid">
        <StatCard
          icon="wallet"
          tone="indigo"
          label="Unallocated Available"
          amount={ugx(balances.unallocatedAvailableMoney)}
          change={ugxAbs(balances.actualAccountBalance)}
          changeLabel="actual personal balance"
          onClick={() => setActive("Finance")}
        />
        <StatCard
          icon="arrowDown"
          tone="green"
          label="Personal Income (Month)"
          amount={ugxAbs(monthlyIncome.totalEligiblePersonalIncome)}
          change={`${snapshot.settings.tithePercent + snapshot.settings.thanksgivingPercent + snapshot.settings.seedPercent}%`}
          changeLabel="auto-giving rule active"
          onClick={() => setActive("Finance")}
        />
        <StatCard
          icon="arrowUp"
          tone="amber"
          label="Outflows this month"
          amount={ugxAbs(monthlyExpenses.total)}
          change={ugxAbs(monthlyExpenses.givingPaid)}
          changeLabel="in confirmed giving"
          inverse={monthlyExpenses.total > monthlyIncome.totalEligiblePersonalIncome && monthlyIncome.totalEligiblePersonalIncome > 0}
          onClick={() => setActive("Transactions")}
        />
        <StatCard
          icon="shield"
          tone="violet"
          label="Entrusted Funds"
          amount={ugxAbs(balances.entrustedBalances)}
          change={`${snapshot.entrustedFunds.filter((f) => f.status === "active").length} active`}
          changeLabel="ring-fenced funds"
          onClick={() => setActive("Entrusted Funds")}
        />
      </section>

      <FiveBalancesIntegrityStrip
        snapshot={snapshot}
        onPayObligationsClick={() => setActive("Finance")}
      />

      <section className="dashboard-grid top-grid">
        <div className="card cash-card">
          <div className="card-head">
            <div>
              <h2>Cash Flow</h2>
              <p>Derived from authenticated personal income & outflows</p>
            </div>
            <div className="select-wrap">
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option>6 months</option>
                <option>3 months</option>
                <option>12 months</option>
              </select>
              <Icon name="arrowDown" size={13} />
            </div>
          </div>
          <div className="legend">
            <span>
              <i className="income-dot" />
              Personal Income
            </span>
            <span>
              <i className="expense-dot" />
              Personal Outflows
            </span>
            <strong>
              {netMonthCashFlow >= 0 ? "+" : "−"}{" "}
              {ugxAbs(netMonthCashFlow)} net ({currentMonthKey})
            </strong>
          </div>
          <DynamicCashFlowChart
            snapshot={snapshot}
            periodMonths={periodCount}
            anchorMonthKey={currentMonthKey}
          />
        </div>

        <div className="card budget-card">
          <div className="card-head">
            <div>
              <h2>Budget overview</h2>
              <p>{currentMonthKey}</p>
            </div>
            <button type="button" onClick={() => setActive("Budgets")}>
              <Icon name="chevron" />
            </button>
          </div>
          <div className="donut-row">
            <div
              className="donut"
              style={{
                background: `conic-gradient(#4f46e5 0 ${budgetPct}%, #ecebff ${budgetPct}%)`,
              }}
            >
              <span>
                <strong>{budgetPct}%</strong>
                <small>used</small>
              </span>
            </div>
            <div className="budget-total">
              <span>Personal Spent</span>
              <strong>{ugxAbs(totalBudgetSpent)}</strong>
              <small>of {ugxAbs(totalBudgetLimit)}</small>
            </div>
          </div>
          <div className="budget-lines">
            {budgetRows.map((b) => {
              const pct =
                b.limitAmount > 0
                  ? Math.min(100, (b.spent / b.limitAmount) * 100)
                  : 0
              return (
                <div className="budget-line" key={b.id}>
                  <div>
                    <span>
                      <i className={b.color} />
                      {b.categoryName}
                    </span>
                    <b>
                      {ugxAbs(b.spent)}{" "}
                      <small>/ {Math.round(b.limitAmount / 1000)}K</small>
                    </b>
                  </div>
                  <div className="progress">
                    <i className={b.color} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="dashboard-grid bottom-grid">
        <div className="card transactions-card">
          <div className="card-head">
            <div>
              <h2>Recent transactions</h2>
              <p>Click any record to inspect audit trail or correct</p>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => setActive("Transactions")}
            >
              View all <Icon name="chevron" size={14} />
            </button>
          </div>
          <div className="filter-tabs">
            {["All", "Income", "Expenses"].map((f) => (
              <button
                type="button"
                key={f}
                className={txFilter === f ? "active" : ""}
                onClick={() => setTxFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="transaction-list">
            {visibleTx.length === 0 ? (
              <div className="empty-state">
                <p>No transactions recorded yet in this view.</p>
                <div className="empty-actions">
                  <button
                    type="button"
                    className="quick-add"
                    onClick={() => onOpenQuickAdd("Income")}
                  >
                    <Icon name="plus" size={14} /> Record income
                  </button>
                  <button
                    type="button"
                    className="outline-btn"
                    onClick={() => onOpenQuickAdd("Expense")}
                  >
                    Record expense
                  </button>
                </div>
              </div>
            ) : (
              visibleTx.map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  onSelect={onInspectTransaction}
                />
              ))
            )}
          </div>
        </div>

        <div className="right-stack">
          <div className="card tasks-card">
            <div className="card-head">
              <div>
                <h2>Today’s tasks</h2>
                <p>
                  {snapshot.tasks.filter((t) => t.done).length} of{" "}
                  {snapshot.tasks.length} completed
                </p>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => setActive("Tasks")}
              >
                View all <Icon name="chevron" size={14} />
              </button>
            </div>
            <div className="task-progress">
              <i
                style={{
                  width: `${
                    snapshot.tasks.length > 0
                      ? (snapshot.tasks.filter((t) => t.done).length /
                          snapshot.tasks.length) *
                        100
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="task-list">
              {snapshot.tasks.length === 0 ? (
                <p className="muted-hint">
                  No tasks yet — click Quick Add to capture priorities.
                </p>
              ) : (
                snapshot.tasks.slice(0, 4).map((task) => (
                  <div
                    className={`task ${task.done ? "done" : ""}`}
                    key={task.id}
                  >
                    <button
                      type="button"
                      onClick={() => toggleTask(task)}
                      aria-label={`Mark ${task.title} ${
                        task.done ? "incomplete" : "complete"
                      }`}
                    >
                      <span>
                        {task.done && <Icon name="check" size={13} />}
                      </span>
                    </button>
                    <div>
                      <strong>{task.title}</strong>
                      <small>
                        <Icon name="clock" size={12} />
                        {task.meta}
                      </small>
                    </div>
                    <i className={`priority ${task.priority.toLowerCase()}`} />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card schedule-card">
            <div className="card-head">
              <div>
                <h2>Up next</h2>
                <p>Scheduled blocks & commitments</p>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => setActive("Calendar")}
              >
                Calendar <Icon name="chevron" size={14} />
              </button>
            </div>
            {snapshot.calendarEvents.length === 0 ? (
              <p className="muted-hint">
                No calendar events scheduled yet.
              </p>
            ) : (
              snapshot.calendarEvents.slice(0, 3).map((ev) => (
                <div className="event" key={ev.id}>
                  <div className="event-time">
                    <strong>{ev.startTime}</strong>
                    <span>{ev.date.slice(5)}</span>
                  </div>
                  <i className={ev.color === "amber" ? "amber" : ""} />
                  <div>
                    <strong>{ev.title}</strong>
                    <span>
                      <Icon name="clock" size={12} /> {ev.durationLabel} ·{" "}
                      {ev.scope}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </>
  )
}

