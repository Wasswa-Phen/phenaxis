import { FormEvent, useMemo, useState } from "react"
import {
  analyzeFinancialPosition,
  answerAccountantQuery,
} from "../domain/aiAccountant"
import {
  buildIncomeSourceReports,
  buildMonthlyGivingSummary,
  buildMonthlyIncomeSummary,
  deriveBalances,
  reconcileMonth,
  toMonthKey,
} from "../domain/ledgerEngine"
import {
  AccountType,
  ELIGIBLE_INCOME_TYPES,
  EligibleIncomeType,
  GivingAllocation,
  LedgerTransaction,
  UserFinancialSnapshot,
} from "../domain/types"
import {
  createUniqueId,
  defaultRepository,
} from "../services/phenaxisRepository"
import { QuickAddTab } from "./ActionModals"
import {
  DynamicCashFlowChart,
  FiveBalancesIntegrityStrip,
  TransactionRow,
} from "./DashboardView"
import { Icon, safeIconName, ugx, ugxAbs } from "./Icons"

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) =>
      r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","),
    )
    .join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function FinanceCommandPage({
  uid,
  snapshot,
  onOpenQuickAdd,
  onPayAllocation,
  onInspectTransaction,
}: {
  uid: string
  snapshot: UserFinancialSnapshot
  onOpenQuickAdd: (tab: QuickAddTab) => void
  onPayAllocation: (alloc: GivingAllocation) => void
  onInspectTransaction: (tx: LedgerTransaction) => void
}) {
  const [subTab, setSubTab] = useState<
    "overview" | "income" | "giving" | "savings"
  >("overview")
  const todayIso = new Date().toISOString().slice(0, 10)
  const [selectedMonth, setSelectedMonth] = useState(() => toMonthKey(todayIso))

  const balances = useMemo(() => deriveBalances(snapshot), [snapshot])
  const aiAnalysis = useMemo(
    () => analyzeFinancialPosition(snapshot, `${selectedMonth}-15`),
    [snapshot, selectedMonth],
  )
  const givingSummary = useMemo(
    () => buildMonthlyGivingSummary(snapshot, selectedMonth),
    [snapshot, selectedMonth],
  )
  const sourceReports = useMemo(
    () => buildIncomeSourceReports(snapshot),
    [snapshot],
  )

  // AI Accountant Q&A state
  const [aiPrompt, setAiPrompt] = useState("")
  const [aiHistory, setAiHistory] = useState<
    { q: string; a: string }[]
  >([])

  const askAccountant = (questionText: string) => {
    const trimmed = questionText.trim()
    if (!trimmed) return
    const reply = answerAccountantQuery(trimmed, snapshot, todayIso)
    setAiHistory((prev) => [{ q: trimmed, a: reply }, ...prev.slice(0, 4)])
    setAiPrompt("")
  }

  // Giving filter
  const [givingFilter, setGivingFilter] = useState<"unpaid" | "paid" | "all">(
    "unpaid",
  )
  const filteredAllocations = useMemo(() => {
    return snapshot.allocations.filter((a) => {
      if (a.status === "voided") return false
      if (givingFilter === "unpaid") return a.status === "unpaid"
      if (givingFilter === "paid") return a.status === "paid"
      return true
    })
  }, [snapshot.allocations, givingFilter])

  // New Income Source inline form
  const [newSrcName, setNewSrcName] = useState("")
  const [newSrcType, setNewSrcType] = useState<
    EligibleIncomeType | "business_gross_revenue"
  >("freelance_earnings")
  const [newSrcDesc, setNewSrcDesc] = useState("")

  const addIncomeSource = async (e: FormEvent) => {
    e.preventDefault()
    if (!newSrcName.trim()) return
    const nowIso = new Date().toISOString()
    await defaultRepository.saveEntity(uid, "income_sources", {
      id: createUniqueId("src"),
      ownerUid: uid,
      name: newSrcName.trim(),
      defaultIncomeType: newSrcType,
      isBusinessSource: newSrcType === "business_gross_revenue",
      description: newSrcDesc.trim() || "Tracked income source",
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    setNewSrcName("")
    setNewSrcDesc("")
  }

  // Savings Goals & Recurring Expenses state
  const [goalName, setGoalName] = useState("")
  const [goalTarget, setGoalTarget] = useState("")
  const [goalDate, setGoalDate] = useState("2027-06-30")
  const [earmarkAmounts, setEarmarkAmounts] = useState<Record<string, string>>(
    {},
  )

  const addSavingsGoal = async (e: FormEvent) => {
    e.preventDefault()
    if (!goalName.trim() || Number(goalTarget) <= 0) return
    const nowIso = new Date().toISOString()
    await defaultRepository.saveEntity(uid, "savings_goals", {
      id: createUniqueId("goal"),
      ownerUid: uid,
      name: goalName.trim(),
      targetAmount: Math.round(Number(goalTarget)),
      targetDate: goalDate,
      linkedAccountId: null,
      color: "green",
      notes: "",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    setGoalName("")
    setGoalTarget("")
  }

  const moveSavings = async (
    goalId: string,
    direction: "deposit" | "withdrawal",
  ) => {
    const val = Math.round(Number(earmarkAmounts[goalId] || 0))
    if (val <= 0) return
    await defaultRepository.recordSavingsMovement(uid, {
      idempotencyKey: createUniqueId("idem_sav"),
      savingsGoalId: goalId,
      direction,
      amount: val,
      date: todayIso,
      accountId: null,
      notes: `${direction === "deposit" ? "Earmarked" : "Released"} via Savings panel`,
    })
    setEarmarkAmounts((prev) => ({ ...prev, [goalId]: "" }))
  }

  const [recName, setRecName] = useState("")
  const [recAmount, setRecAmount] = useState("")
  const [recDay, setRecDay] = useState("5")
  const [recCatId, setRecCatId] = useState(
    snapshot.categories.find((c) => c.kind === "personal_expense")?.id ??
      "cat_utilities",
  )
  const [recAccId, setRecAccId] = useState(
    snapshot.accounts.find((a) => a.type !== "business")?.id ?? "acc_stanbic",
  )

  const addRecurring = async (e: FormEvent) => {
    e.preventDefault()
    if (!recName.trim() || Number(recAmount) <= 0) return
    const nowIso = new Date().toISOString()
    const cat = snapshot.categories.find((c) => c.id === recCatId)
    await defaultRepository.saveEntity(uid, "recurring_expenses", {
      id: createUniqueId("rec"),
      ownerUid: uid,
      name: recName.trim(),
      categoryId: recCatId,
      categoryName: cat?.name ?? "Monthly Commitment",
      defaultAccountId: recAccId,
      amount: Math.round(Number(recAmount)),
      dueDayOfMonth: Math.max(1, Math.min(31, Number(recDay) || 1)),
      frequency: "monthly",
      active: true,
      lastPaidMonthKey: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    setRecName("")
    setRecAmount("")
  }

  const payRecurringNow = async (recId: string) => {
    const rec = snapshot.recurringExpenses.find((r) => r.id === recId)
    if (!rec) return
    await defaultRepository.recordExpense(uid, {
      idempotencyKey: createUniqueId("idem_rec"),
      title: rec.name,
      description: `Monthly recurring commitment (${selectedMonth})`,
      amount: rec.amount,
      date: todayIso,
      accountId: rec.defaultAccountId,
      categoryId: rec.categoryId,
      recurringExpenseId: rec.id,
      allowDuplicateFingerprint: true,
    })
  }

  const totalPct =
    snapshot.settings.tithePercent +
    snapshot.settings.thanksgivingPercent +
    snapshot.settings.seedPercent

  return (
    <div className="page-content">
      <FiveBalancesIntegrityStrip
        snapshot={snapshot}
        onPayObligationsClick={() => setSubTab("giving")}
      />

      <div className="module-toolbar">
        <div className="filter-tabs">
          <button
            type="button"
            className={subTab === "overview" ? "active" : ""}
            onClick={() => setSubTab("overview")}
          >
            Overview & AI Accountant
          </button>
          <button
            type="button"
            className={subTab === "income" ? "active" : ""}
            onClick={() => setSubTab("income")}
          >
            Income Streams ({snapshot.incomeSources.length})
          </button>
          <button
            type="button"
            className={subTab === "giving" ? "active" : ""}
            onClick={() => setSubTab("giving")}
          >
            Giving Allocations (
            {snapshot.allocations.filter((a) => a.status === "unpaid").length}{" "}
            due)
          </button>
          <button
            type="button"
            className={subTab === "savings" ? "active" : ""}
            onClick={() => setSubTab("savings")}
          >
            Savings & Commitments
          </button>
        </div>
        <div>
          <input
            type="month"
            className="month-picker-input"
            value={selectedMonth}
            onChange={(e) =>
              e.target.value && setSelectedMonth(e.target.value)
            }
          />
          <button
            type="button"
            className="outline-btn"
            onClick={() => onOpenQuickAdd("Income")}
          >
            <Icon name="plus" size={16} /> Record Income
          </button>
        </div>
      </div>

      {subTab === "overview" && (
        <>
          <div className="module-grid">
            <div className="card large-module">
              <div className="card-head">
                <div>
                  <h2>Personal Cash Flow & Position</h2>
                  <p>
                    Business Retained Balance:{" "}
                    <strong>{ugx(balances.businessRetainedBalance)}</strong>{" "}
                    (excluded from personal income until withdrawn)
                  </p>
                </div>
              </div>
              <DynamicCashFlowChart
                snapshot={snapshot}
                periodMonths={6}
                anchorMonthKey={selectedMonth}
              />
            </div>

            <div className="card insight-card">
              <div className="ai-card-top">
                <div className="sparkle" style={{ marginBottom: 0 }}>
                  <Icon name="sparkle" />
                </div>
                <span className="ai-score-pill">
                  Integrity Score · {aiAnalysis.healthScore}/100
                </span>
              </div>
              <span style={{ marginTop: 14 }}>PHENAXIS AI ACCOUNTANT</span>
              <h3>{aiAnalysis.headline}</h3>
              <p>{aiAnalysis.executiveSummary}</p>

              <div className="ai-quick-chips">
                {[
                  "Can I afford UGX 250,000?",
                  "Giving obligations summary",
                  "Analyze my income streams",
                  "Savings goal progress",
                ].map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    className="ai-chip"
                    onClick={() => askAccountant(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <form
                className="ai-ask-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  askAccountant(aiPrompt)
                }}
              >
                <input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Ask your AI Accountant about your real figures..."
                />
                <button type="submit" aria-label="Ask AI Accountant">
                  <Icon name="send" size={16} />
                </button>
              </form>
            </div>
          </div>

          {aiHistory.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>AI Accountant Responses</h2>
                  <p>Computed directly from your authenticated ledger</p>
                </div>
              </div>
              <div className="ai-qa-list">
                {aiHistory.map((item, idx) => (
                  <div className="ai-qa-item" key={idx}>
                    <strong>Q: {item.q}</strong>
                    <p>{item.a}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Position-Based Recommendations</h2>
                <p>
                  Live analysis of income streams, giving obligations, recurring
                  commitments, and available liquidity
                </p>
              </div>
            </div>
            <div className="ai-insights-grid">
              {aiAnalysis.insights.map((ins) => (
                <div
                  className={`ai-insight-box ${ins.severity}`}
                  key={ins.id}
                >
                  <div className="ai-insight-top">
                    <span className="phx-badge">{ins.category}</span>
                    <strong>
                      {ins.metricLabel}: {ins.metricValue}
                    </strong>
                  </div>
                  <h4>{ins.title}</h4>
                  <p>{ins.detail}</p>
                  <small>Recommendation: {ins.recommendation}</small>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {subTab === "income" && (
        <>
          <div className="accountability-banner">
            <div>
              <Icon name="briefcase" />
              <div>
                <strong>
                  Strict Separation of Personal Income & Business Gross Revenue
                </strong>
                <span>
                  Employment, freelance, client projects, creative/tech
                  services, ministry allowances, personal gifts, and owner
                  withdrawals reserve {totalPct}% giving. Business gross revenue
                  and project costs are tracked separately until withdrawn.
                </span>
              </div>
            </div>
            <button type="button" onClick={() => onOpenQuickAdd("Income")}>
              + Record Income
            </button>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Individual Income-Source Performance</h2>
                <p>
                  All-time breakdown across every registered income stream &
                  business venture
                </p>
              </div>
              <button
                type="button"
                className="outline-btn"
                onClick={() => onOpenQuickAdd("Expense")}
              >
                + Record Project Cost
              </button>
            </div>
            <div className="phx-table-wrap">
              <table className="phx-table">
                <thead>
                  <tr>
                    <th>Income Source</th>
                    <th>Default Stream</th>
                    <th>Entries</th>
                    <th>Personal Income</th>
                    <th>Business Gross</th>
                    <th>Project Costs</th>
                    <th>Retained Biz</th>
                    <th>Giving Reserved</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceReports.map((row) => (
                    <tr key={row.sourceId}>
                      <td>
                        <strong>{row.sourceName}</strong>
                      </td>
                      <td>{row.defaultType.replace(/_/g, " ")}</td>
                      <td>{row.transactionCount}</td>
                      <td className="tone-green">
                        {ugxAbs(row.eligiblePersonalIncome)}
                      </td>
                      <td>{ugxAbs(row.businessGrossRevenue)}</td>
                      <td>{ugxAbs(row.projectCosts)}</td>
                      <td>{ugx(row.retainedBusinessEarnings)}</td>
                      <td className="tone-indigo">
                        {ugxAbs(row.givingAllocated)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Register New Income Source</h2>
                <p>
                  Saved under <code>users/{uid}/income_sources</code>
                </p>
              </div>
            </div>
            <form className="inline-grid-form" onSubmit={addIncomeSource}>
              <input
                required
                placeholder="Source name (e.g. Makerere Part-time / Studio Agency)"
                value={newSrcName}
                onChange={(e) => setNewSrcName(e.target.value)}
              />
              <select
                value={newSrcType}
                onChange={(e) =>
                  setNewSrcType(
                    e.target.value as
                      | EligibleIncomeType
                      | "business_gross_revenue",
                  )
                }
              >
                {ELIGIBLE_INCOME_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
                <option value="business_gross_revenue">
                  Business gross revenue (Non-personal)
                </option>
              </select>
              <input
                placeholder="Notes or client details"
                value={newSrcDesc}
                onChange={(e) => setNewSrcDesc(e.target.value)}
              />
              <button type="submit" className="quick-add">
                <Icon name="plus" size={16} /> Add Source
              </button>
            </form>
          </div>
        </>
      )}

      {subTab === "giving" && (
        <>
          <div className="summary-strip">
            <div>
              <span>Active Giving Rule</span>
              <strong>{totalPct}% Total</strong>
              <small>
                Tithe {snapshot.settings.tithePercent}% · Thanks{" "}
                {snapshot.settings.thanksgivingPercent}% · Seed{" "}
                {snapshot.settings.seedPercent}%
              </small>
            </div>
            <div>
              <span>Allocated ({selectedMonth})</span>
              <strong>{ugxAbs(givingSummary.totalAllocated)}</strong>
            </div>
            <div>
              <span>Confirmed Paid ({selectedMonth})</span>
              <strong className="tone-green">
                {ugxAbs(givingSummary.totalCashPaidInMonth)}
              </strong>
            </div>
            <div>
              <span>Total Unpaid Obligations</span>
              <strong className="tone-indigo">
                {ugxAbs(givingSummary.allTimeUnpaidObligations)}
              </strong>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Monthly Giving Summary ({selectedMonth})</h2>
                <p>
                  Paid obligations deduct from your account balance once and
                  close the reserved obligation
                </p>
              </div>
            </div>
            <div className="phx-table-wrap">
              <table className="phx-table">
                <thead>
                  <tr>
                    <th>Allocation Pillar</th>
                    <th>Configured Rate</th>
                    <th>Reserved ({selectedMonth})</th>
                    <th>Paid ({selectedMonth} Income)</th>
                    <th>Outstanding ({selectedMonth})</th>
                    <th>Cash Paid in {selectedMonth}</th>
                  </tr>
                </thead>
                <tbody>
                  {(["tithe", "thanksgiving", "seed"] as const).map((type) => {
                    const row = givingSummary.byType[type]
                    const pct =
                      type === "tithe"
                        ? snapshot.settings.tithePercent
                        : type === "thanksgiving"
                          ? snapshot.settings.thanksgivingPercent
                          : snapshot.settings.seedPercent
                    return (
                      <tr key={type}>
                        <td>
                          <strong style={{ textTransform: "capitalize" }}>
                            {type}
                          </strong>
                        </td>
                        <td>{pct}%</td>
                        <td>{ugxAbs(row.allocated)}</td>
                        <td className="tone-green">
                          {ugxAbs(row.paidForMonthIncome)}
                        </td>
                        <td className="tone-indigo">
                          {ugxAbs(row.unpaidForMonthIncome)}
                        </td>
                        <td>{ugxAbs(row.cashPaidInMonth)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card report-table">
            <div className="card-head">
              <div>
                <h2>Giving Allocation Obligations & Payment Ledger</h2>
                <p>
                  Three separate allocation records are linked to each eligible
                  income transaction
                </p>
              </div>
              <div className="filter-tabs" style={{ margin: 0 }}>
                {(["unpaid", "paid", "all"] as const).map((f) => (
                  <button
                    type="button"
                    key={f}
                    className={givingFilter === f ? "active" : ""}
                    onClick={() => setGivingFilter(f)}
                  >
                    {f === "unpaid"
                      ? "Unpaid Obligations"
                      : f === "paid"
                        ? "Paid History"
                        : "All"}
                  </button>
                ))}
              </div>
            </div>

            {filteredAllocations.length === 0 ? (
              <p className="muted-hint">
                {givingFilter === "unpaid"
                  ? "No unpaid giving obligations outstanding."
                  : "No giving allocation records match this filter."}
              </p>
            ) : (
              <div className="phx-table-wrap">
                <table className="phx-table">
                  <thead>
                    <tr>
                      <th>Pillar</th>
                      <th>Linked Income Record</th>
                      <th>Source</th>
                      <th>Income Date</th>
                      <th>Obligation</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAllocations.map((alloc) => (
                      <tr key={alloc.id}>
                        <td>
                          <span className="phx-badge indigo">
                            {alloc.label} ({alloc.percentage}%)
                          </span>
                        </td>
                        <td>
                          <strong>{alloc.sourceTransactionTitle}</strong>
                          <small className="block-sub">
                            Base: {ugxAbs(alloc.baseIncomeAmount)}
                          </small>
                        </td>
                        <td>{alloc.incomeSourceName}</td>
                        <td>{alloc.incomeDate}</td>
                        <td>
                          <strong>{ugxAbs(alloc.amount)}</strong>
                        </td>
                        <td>
                          <span
                            className={`phx-badge ${alloc.status === "paid" ? "green" : "amber"}`}
                          >
                            {alloc.status === "paid"
                              ? `Paid (${alloc.paidFromAccountName ?? "Account"})`
                              : "Unpaid Obligation"}
                          </span>
                        </td>
                        <td>
                          {alloc.status === "unpaid" ? (
                            <button
                              type="button"
                              className="quick-add btn-compact"
                              onClick={() => onPayAllocation(alloc)}
                            >
                              Confirm Payment
                            </button>
                          ) : (
                            <span className="muted-cell">
                              {alloc.paidAt ?? "Settled"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {subTab === "savings" && (
        <div className="dashboard-grid top-grid">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Savings Goals ({ugxAbs(balances.savingsBalances)})</h2>
                <p>
                  Earmarking funds reserves money from Unallocated Available
                  without faking external expenses
                </p>
              </div>
            </div>

            <form
              className="inline-grid-form"
              style={{ marginTop: 12, marginBottom: 14 }}
              onSubmit={addSavingsGoal}
            >
              <input
                required
                placeholder="Goal name (e.g. Emergency Reserve)"
                value={goalName}
                onChange={(e) => setGoalName(e.target.value)}
              />
              <input
                type="number"
                required
                min={1}
                placeholder="Target UGX (e.g. 3000000)"
                value={goalTarget}
                onChange={(e) => setGoalTarget(e.target.value)}
              />
              <input
                type="date"
                value={goalDate}
                onChange={(e) => setGoalDate(e.target.value)}
              />
              <button type="submit" className="quick-add">
                <Icon name="plus" size={16} /> Add Goal
              </button>
            </form>

            {snapshot.savingsGoals.length === 0 ? (
              <p className="muted-hint">
                No savings goals yet — create your first goal above.
              </p>
            ) : (
              <div className="goal-stack">
                {snapshot.savingsGoals.map((goal) => {
                  const saved = balances.savingsGoalBalances[goal.id] ?? 0
                  const pct =
                    goal.targetAmount > 0
                      ? Math.min(
                          100,
                          Math.round((saved / goal.targetAmount) * 100),
                        )
                      : 0
                  return (
                    <div className="phx-subbox" key={goal.id}>
                      <div className="goal-row-head">
                        <div>
                          <strong>{goal.name}</strong>
                          <small className="block-sub">
                            Target {ugxAbs(goal.targetAmount)} by{" "}
                            {goal.targetDate}
                          </small>
                        </div>
                        <strong>
                          {ugxAbs(saved)} ({pct}%)
                        </strong>
                      </div>
                      <div className="progress" style={{ marginBottom: 10 }}>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <div className="goal-actions">
                        <input
                          type="number"
                          min={1}
                          placeholder="Amount UGX"
                          value={earmarkAmounts[goal.id] ?? ""}
                          onChange={(e) =>
                            setEarmarkAmounts((prev) => ({
                              ...prev,
                              [goal.id]: e.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="outline-btn"
                          onClick={() => moveSavings(goal.id, "deposit")}
                        >
                          + Earmark
                        </button>
                        <button
                          type="button"
                          className="outline-btn"
                          onClick={() => moveSavings(goal.id, "withdrawal")}
                        >
                          Release
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Recurring Monthly Expenses</h2>
                <p>
                  Tracked by AI Accountant to protect upcoming monthly
                  commitments
                </p>
              </div>
            </div>

            <form
              className="phx-form"
              style={{ marginTop: 12, marginBottom: 14 }}
              onSubmit={addRecurring}
            >
              <div className="form-row">
                <input
                  required
                  placeholder="Commitment (e.g. Rent / Internet)"
                  value={recName}
                  onChange={(e) => setRecName(e.target.value)}
                />
                <input
                  type="number"
                  required
                  min={1}
                  placeholder="Monthly UGX"
                  value={recAmount}
                  onChange={(e) => setRecAmount(e.target.value)}
                />
              </div>
              <div className="form-row">
                <select
                  value={recCatId}
                  onChange={(e) => setRecCatId(e.target.value)}
                >
                  {snapshot.categories
                    .filter((c) => c.kind === "personal_expense")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <select
                  value={recAccId}
                  onChange={(e) => setRecAccId(e.target.value)}
                >
                  {snapshot.accounts
                    .filter((a) => a.type !== "business")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-row">
                <input
                  type="number"
                  min={1}
                  max={31}
                  placeholder="Due day (1-31)"
                  value={recDay}
                  onChange={(e) => setRecDay(e.target.value)}
                />
                <button type="submit" className="quick-add">
                  <Icon name="plus" size={16} /> Add Recurring
                </button>
              </div>
            </form>

            {snapshot.recurringExpenses.length === 0 ? (
              <p className="muted-hint">
                No recurring commitments registered yet.
              </p>
            ) : (
              snapshot.recurringExpenses.map((rec) => {
                const isPaid = rec.lastPaidMonthKey === selectedMonth
                return (
                  <div className="transaction" key={rec.id}>
                    <div className="transaction-icon indigo">
                      <Icon name="repeat" />
                    </div>
                    <div className="transaction-name">
                      <strong>{rec.name}</strong>
                      <span>
                        Due day {rec.dueDayOfMonth} · {rec.categoryName} ·{" "}
                        {ugxAbs(rec.amount)}
                      </span>
                    </div>
                    <span className="transaction-date">
                      {ugxAbs(rec.amount)}
                    </span>
                    {isPaid ? (
                      <span className="phx-badge green">Paid</span>
                    ) : (
                      <button
                        type="button"
                        className="outline-btn"
                        onClick={() => payRecurringNow(rec.id)}
                      >
                        Pay
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function TransactionsPage({
  snapshot,
  searchQuery,
  onOpenQuickAdd,
  onInspectTransaction,
}: {
  snapshot: UserFinancialSnapshot
  searchQuery: string
  onOpenQuickAdd: (tab: QuickAddTab) => void
  onInspectTransaction: (tx: LedgerTransaction) => void
}) {
  const [filter, setFilter] = useState<string>("All")

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return snapshot.transactions.filter((tx) => {
      if (filter !== "Voided" && tx.status === "voided") return false
      if (filter === "Voided" && tx.status !== "voided") return false
      if (
        filter === "Personal Income" &&
        tx.kind !== "personal_income" &&
        tx.kind !== "owner_withdrawal"
      )
        return false
      if (filter === "Expenses" && tx.kind !== "personal_expense") return false
      if (filter === "Giving Paid" && tx.kind !== "allocation_payment")
        return false
      if (
        filter === "Business & Costs" &&
        tx.kind !== "business_revenue" &&
        tx.kind !== "project_cost" &&
        tx.kind !== "owner_withdrawal_out"
      )
        return false
      if (filter === "Transfers" && tx.kind !== "transfer") return false
      if (
        filter === "Entrusted" &&
        tx.kind !== "entrusted_inflow" &&
        tx.kind !== "entrusted_outflow"
      )
        return false

      if (!q) return true
      return (
        tx.title.toLowerCase().includes(q) ||
        tx.description.toLowerCase().includes(q) ||
        tx.accountName.toLowerCase().includes(q) ||
        (tx.incomeSourceName ?? "").toLowerCase().includes(q) ||
        (tx.categoryName ?? "").toLowerCase().includes(q) ||
        tx.id.toLowerCase().includes(q)
      )
    })
  }, [snapshot.transactions, filter, searchQuery])

  const exportLedgerCsv = () => {
    const rows = [
      [
        "ID",
        "Date",
        "Kind",
        "Direction",
        "Status",
        "Title",
        "Source/Category",
        "Account",
        "Amount_UGX",
      ],
      ...filtered.map((t) => [
        t.id,
        t.date,
        t.kind,
        t.direction,
        t.status,
        t.title,
        t.incomeSourceName || t.categoryName || "",
        t.accountName,
        String(t.amount),
      ]),
    ]
    downloadCsv(`phenaxis-transactions-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  return (
    <div className="page-content">
      <div className="module-toolbar">
        <div className="filter-tabs" style={{ flexWrap: "wrap" }}>
          {[
            "All",
            "Personal Income",
            "Expenses",
            "Giving Paid",
            "Business & Costs",
            "Transfers",
            "Entrusted",
            "Voided",
          ].map((f) => (
            <button
              type="button"
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div>
          <button
            type="button"
            className="outline-btn"
            onClick={exportLedgerCsv}
          >
            <Icon name="download" size={16} /> Export CSV
          </button>
        </div>
      </div>

      <div className="card report-table">
        <div className="card-head">
          <div>
            <h2>Auditable Ledger ({filtered.length} records)</h2>
            <p>
              Click any entry to view its immutable ID, idempotency key, linked
              giving allocations, or apply an auditable correction
            </p>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => onOpenQuickAdd("Income")}
          >
            + Add entry
          </button>
        </div>
        {filtered.length === 0 ? (
          <p className="muted-hint">No ledger transactions match this filter.</p>
        ) : (
          filtered.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              onSelect={onInspectTransaction}
            />
          ))
        )}
      </div>
    </div>
  )
}

export function AccountsPage({
  uid,
  snapshot,
  onOpenQuickAdd,
}: {
  uid: string
  snapshot: UserFinancialSnapshot
  onOpenQuickAdd: (tab: QuickAddTab) => void
}) {
  const balances = useMemo(() => deriveBalances(snapshot), [snapshot])
  const [name, setName] = useState("")
  const [institution, setInstitution] = useState("")
  const [type, setType] = useState<AccountType>("bank")

  const createAccount = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const nowIso = new Date().toISOString()
    await defaultRepository.saveEntity(uid, "accounts", {
      id: createUniqueId("acc"),
      ownerUid: uid,
      name: name.trim(),
      type,
      institution: institution.trim() || name.trim(),
      currency: "UGX",
      color:
        type === "business"
          ? "violet"
          : type === "mobile_money"
            ? "amber"
            : type === "cash"
              ? "green"
              : "indigo",
      icon: type === "bank" ? "bank" : type === "business" ? "briefcase" : "wallet",
      isArchived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    setName("")
    setInstitution("")
  }

  return (
    <div className="page-content">
      <FiveBalancesIntegrityStrip snapshot={snapshot} />

      <div className="accountability-banner">
        <div>
          <Icon name="bank" />
          <div>
            <strong>100% Transaction-Derived Account Balances</strong>
            <span>
              Account balances are never manually editable — every figure below
              is computed automatically from verified inflows, outflows, and
              linked transfers.
            </span>
          </div>
        </div>
        <button type="button" onClick={() => onOpenQuickAdd("Transfer")}>
          Transfer Between Accounts
        </button>
      </div>

      <div className="fund-grid">
        {snapshot.accounts
          .filter((a) => !a.isArchived)
          .map((acc) => {
            const bal = balances.accountBalances[acc.id] ?? 0
            const txCount = snapshot.transactions.filter(
              (t) => t.status !== "voided" && t.accountId === acc.id,
            ).length
            return (
              <div className="card fund-card" key={acc.id}>
                <div className={`fund-icon ${acc.color}`}>
                  <Icon name={safeIconName(acc.icon)} />
                </div>
                <h3>{acc.name}</h3>
                <span className="status">
                  <i />{" "}
                  {acc.type === "business"
                    ? "Business Ledger Account"
                    : `Personal · ${acc.type.replace("_", " ")}`}
                </span>
                <div className="fund-balance">
                  <span>Derived actual balance</span>
                  <strong>{ugx(bal)}</strong>
                </div>
                <div className="fund-stats">
                  <span>
                    Institution<b>{acc.institution}</b>
                  </span>
                  <span>
                    Ledger entries<b>{txCount} records</b>
                  </span>
                </div>
              </div>
            )
          })}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Add Cash, Bank, Mobile Money, or Business Account</h2>
            <p>
              Saved under <code>users/{uid}/accounts</code> (use Opening Balance
              inflow to bring existing balances onto the ledger)
            </p>
          </div>
        </div>
        <form className="inline-grid-form" onSubmit={createAccount}>
          <input
            required
            placeholder="Account name (e.g. Centenary Bank)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            <option value="bank">Bank Account (Personal)</option>
            <option value="mobile_money">Mobile Money (Personal)</option>
            <option value="cash">Cash Wallet (Personal)</option>
            <option value="savings">Savings Account (Personal)</option>
            <option value="business">Business Operating Account</option>
          </select>
          <input
            placeholder="Institution or branch"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          />
          <button type="submit" className="quick-add">
            <Icon name="plus" size={16} /> Add Account
          </button>
        </form>
      </div>
    </div>
  )
}

export function EntrustedFundsPage({
  snapshot,
  onOpenQuickAdd,
  onInspectTransaction,
}: {
  snapshot: UserFinancialSnapshot
  onOpenQuickAdd: (tab: QuickAddTab) => void
  onInspectTransaction: (tx: LedgerTransaction) => void
}) {
  const balances = useMemo(() => deriveBalances(snapshot), [snapshot])

  const totals = useMemo(() => {
    let received = 0
    let spent = 0
    for (const s of Object.values(balances.entrustedFundSummaries)) {
      received += s.received
      spent += s.spent
    }
    return { received, spent, remaining: received - spent }
  }, [balances.entrustedFundSummaries])

  const entrustedTxs = useMemo(
    () =>
      snapshot.transactions.filter(
        (t) =>
          t.status !== "voided" &&
          (t.kind === "entrusted_inflow" || t.kind === "entrusted_outflow"),
      ),
    [snapshot.transactions],
  )

  return (
    <div className="page-content">
      <div className="accountability-banner">
        <div>
          <Icon name="shield" />
          <div>
            <strong>Protected accountability</strong>
            <span>
              Entrusted funds are tracked separately, never included in your
              personal balance, and never trigger personal giving allocations.
            </span>
          </div>
        </div>
        <button type="button" onClick={() => onOpenQuickAdd("Entrusted")}>
          + Record Fund Activity
        </button>
      </div>

      <div className="summary-strip">
        <div>
          <span>Total received</span>
          <strong>{ugxAbs(totals.received)}</strong>
        </div>
        <div>
          <span>Total disbursed</span>
          <strong>{ugxAbs(totals.spent)}</strong>
        </div>
        <div>
          <span>Total remaining</span>
          <strong>{ugx(totals.remaining)}</strong>
        </div>
        <div>
          <span>Active funds</span>
          <strong>
            {snapshot.entrustedFunds.filter((f) => f.status === "active").length}
          </strong>
        </div>
      </div>

      {snapshot.entrustedFunds.length === 0 ? (
        <div className="card empty-state">
          <p>
            No entrusted funds registered yet. Create a fund to steward church,
            class, family, or community money separately from your personal
            accounts.
          </p>
          <button
            type="button"
            className="quick-add"
            onClick={() => onOpenQuickAdd("Entrusted")}
          >
            <Icon name="plus" size={16} /> New entrusted fund
          </button>
        </div>
      ) : (
        <div className="fund-grid">
          {snapshot.entrustedFunds.map((f) => {
            const sum = balances.entrustedFundSummaries[f.id] ?? {
              received: 0,
              spent: 0,
              remaining: 0,
            }
            const pct =
              sum.received > 0
                ? Math.min(100, Math.round((sum.spent / sum.received) * 100))
                : 0
            return (
              <div className="card fund-card" key={f.id}>
                <div className={`fund-icon ${f.color}`}>
                  <Icon name={safeIconName(f.icon)} />
                </div>
                <h3>{f.name}</h3>
                <span className="status">
                  <i /> {f.stewardFor}
                </span>
                <div className="fund-balance">
                  <span>Remaining custodial balance</span>
                  <strong>{ugx(sum.remaining)}</strong>
                </div>
                <div className="fund-stats">
                  <span>
                    Received<b>{ugxAbs(sum.received)}</b>
                  </span>
                  <span>
                    Spent<b>{ugxAbs(sum.spent)}</b>
                  </span>
                </div>
                <div className="progress">
                  <i className={f.color} style={{ width: `${pct}%` }} />
                </div>
                <button
                  type="button"
                  className="outline-btn"
                  onClick={() => onOpenQuickAdd("Entrusted")}
                >
                  Record receipt / disbursement{" "}
                  <Icon name="chevron" size={15} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="card report-table">
        <div className="card-head">
          <div>
            <h2>Custodial Fund Transactions</h2>
            <p>Activity across all ring-fenced entrusted funds</p>
          </div>
        </div>
        {entrustedTxs.length === 0 ? (
          <p className="muted-hint">No custodial fund transactions yet.</p>
        ) : (
          entrustedTxs.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              onSelect={onInspectTransaction}
            />
          ))
        )}
      </div>
    </div>
  )
}

export function BudgetsPage({
  uid,
  snapshot,
}: {
  uid: string
  snapshot: UserFinancialSnapshot
}) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const [monthKey, setMonthKey] = useState(() => toMonthKey(todayIso))
  const [catName, setCatName] = useState("")
  const [limitAmt, setLimitAmt] = useState("")
  const [selectedCatId, setSelectedCatId] = useState(
    snapshot.categories.find((c) => c.kind === "personal_expense")?.id ?? "",
  )

  const rows = useMemo(() => {
    return snapshot.budgets.map((b) => {
      const spent = snapshot.transactions
        .filter(
          (tx) =>
            tx.status !== "voided" &&
            tx.monthKey === monthKey &&
            tx.kind === "personal_expense" &&
            (tx.categoryId === b.categoryId ||
              tx.categoryName === b.categoryName),
        )
        .reduce((s, tx) => s + tx.amount, 0)
      return { ...b, spent }
    })
  }, [snapshot.budgets, snapshot.transactions, monthKey])

  const saveBudgetCap = async (e: FormEvent) => {
    e.preventDefault()
    if (Number(limitAmt) <= 0) return
    const nowIso = new Date().toISOString()

    let catId = selectedCatId
    let resolvedName =
      snapshot.categories.find((c) => c.id === selectedCatId)?.name ?? "Budget"

    if (catName.trim()) {
      catId = createUniqueId("cat")
      resolvedName = catName.trim()
      await defaultRepository.saveEntity(uid, "categories", {
        id: catId,
        ownerUid: uid,
        name: resolvedName,
        kind: "personal_expense",
        color: "indigo",
        icon: "wallet",
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    }

    const existing = snapshot.budgets.find((b) => b.categoryId === catId)
    await defaultRepository.saveEntity(uid, "budgets", {
      id: existing?.id ?? createUniqueId("bud"),
      ownerUid: uid,
      categoryId: catId,
      categoryName: resolvedName,
      monthKey: "default",
      limitAmount: Math.round(Number(limitAmt)),
      color: existing?.color ?? "indigo",
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    })
    setCatName("")
    setLimitAmt("")
  }

  const totalCap = rows.reduce((s, r) => s + r.limitAmount, 0)
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0)

  return (
    <div className="page-content">
      <div className="summary-strip">
        <div>
          <span>Month Evaluated</span>
          <strong>{monthKey}</strong>
        </div>
        <div>
          <span>Total Monthly Budget</span>
          <strong>{ugxAbs(totalCap)}</strong>
        </div>
        <div>
          <span>Actual Personal Spending</span>
          <strong>{ugxAbs(totalSpent)}</strong>
        </div>
        <div>
          <span>Remaining Headroom</span>
          <strong className={totalCap - totalSpent < 0 ? "tone-danger" : "tone-green"}>
            {ugx(totalCap - totalSpent)}
          </strong>
        </div>
      </div>

      <div className="module-toolbar">
        <div />
        <div>
          <input
            type="month"
            className="month-picker-input"
            value={monthKey}
            onChange={(e) => e.target.value && setMonthKey(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Category Spending Caps</h2>
            <p>Give every shilling a purpose before you spend it</p>
          </div>
        </div>
        <div className="budget-lines" style={{ marginTop: 14 }}>
          {rows.map((r) => {
            const pct =
              r.limitAmount > 0
                ? Math.min(100, Math.round((r.spent / r.limitAmount) * 100))
                : 0
            return (
              <div className="budget-line" key={r.id}>
                <div>
                  <span>
                    <i className={r.color} />
                    <strong>{r.categoryName}</strong>
                  </span>
                  <b>
                    {ugxAbs(r.spent)} / {ugxAbs(r.limitAmount)} ({pct}%)
                  </b>
                </div>
                <div className="progress">
                  <i className={r.color} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Add or Update Monthly Category Budget</h2>
            <p>
              Saved under <code>users/{uid}/budgets</code> and{" "}
              <code>categories</code>
            </p>
          </div>
        </div>
        <form className="inline-grid-form" onSubmit={saveBudgetCap}>
          <select
            value={selectedCatId}
            onChange={(e) => setSelectedCatId(e.target.value)}
          >
            {snapshot.categories
              .filter((c) => c.kind === "personal_expense")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <input
            placeholder="Or type new category name..."
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
          />
          <input
            type="number"
            required
            min={1}
            placeholder="Monthly limit (UGX)"
            value={limitAmt}
            onChange={(e) => setLimitAmt(e.target.value)}
          />
          <button type="submit" className="quick-add">
            Save Budget Cap
          </button>
        </form>
      </div>
    </div>
  )
}

export function ReportsPage({
  uid,
  snapshot,
}: {
  uid: string
  snapshot: UserFinancialSnapshot
}) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const [monthKey, setMonthKey] = useState(() => toMonthKey(todayIso))
  const [savedNotice, setSavedNotice] = useState<string | null>(null)

  const balances = useMemo(() => deriveBalances(snapshot), [snapshot])
  const incSummary = useMemo(
    () => buildMonthlyIncomeSummary(snapshot, monthKey),
    [snapshot, monthKey],
  )
  const givSummary = useMemo(
    () => buildMonthlyGivingSummary(snapshot, monthKey),
    [snapshot, monthKey],
  )
  const sourceRows = useMemo(
    () => buildIncomeSourceReports(snapshot, monthKey),
    [snapshot, monthKey],
  )
  const recon = useMemo(
    () => reconcileMonth(snapshot, monthKey),
    [snapshot, monthKey],
  )

  const saveReportSnapshot = async () => {
    const nowIso = new Date().toISOString()
    const reportId = `rep_${monthKey}`
    await defaultRepository.saveEntity(uid, "financial_reports", {
      id: reportId,
      ownerUid: uid,
      monthKey,
      title: `Reconciled Financial Report · ${monthKey}`,
      eligiblePersonalIncome: incSummary.totalEligiblePersonalIncome,
      businessGrossRevenue: incSummary.businessGrossRevenue,
      projectCosts: incSummary.projectCosts,
      ownerWithdrawals: incSummary.ownerWithdrawals,
      personalExpenses: recon.personalLivingExpenses,
      givingAllocated: givSummary.totalAllocated,
      givingPaid: givSummary.totalCashPaidInMonth,
      givingUnpaid: givSummary.allTimeUnpaidObligations,
      actualPersonalBalance: balances.actualAccountBalance,
      reservedObligations: balances.reservedObligations,
      savingsBalances: balances.savingsBalances,
      unallocatedAvailable: balances.unallocatedAvailableMoney,
      entrustedBalances: balances.entrustedBalances,
      reconciled: recon.isReconciled,
      generatedAt: nowIso,
    })
    setSavedNotice(
      `Saved ${monthKey} reconciled snapshot to users/${uid}/financial_reports/${reportId}.`,
    )
  }

  const exportMonthlyReportCsv = () => {
    const rows = [
      ["Metric", "Month", "Amount_UGX"],
      ["Opening Personal Balance", monthKey, String(recon.openingPersonalBalance)],
      ["Eligible Personal Income", monthKey, String(incSummary.totalEligiblePersonalIncome)],
      ["Business Gross Revenue (Excluded)", monthKey, String(incSummary.businessGrossRevenue)],
      ["Project Costs", monthKey, String(incSummary.projectCosts)],
      ["Owner Withdrawals", monthKey, String(incSummary.ownerWithdrawals)],
      ["Non-Income Personal Inflows", monthKey, String(recon.nonIncomePersonalInflows)],
      ["Personal Living Expenses", monthKey, String(recon.personalLivingExpenses)],
      ["Giving Payments Outflow", monthKey, String(recon.givingPaymentsOutflow)],
      ["Closing Personal Balance", monthKey, String(recon.actualClosingPersonalBalance)],
      ["Reconciliation Variance", monthKey, String(recon.variance)],
      ["Giving Allocated (Month)", monthKey, String(givSummary.totalAllocated)],
      ["Unpaid Giving Obligations (Total)", monthKey, String(balances.reservedObligations)],
      ["Unallocated Available Money", monthKey, String(balances.unallocatedAvailableMoney)],
      ["Entrusted Custodial Balances", monthKey, String(balances.entrustedBalances)],
    ]
    downloadCsv(`phenaxis-monthly-report-${monthKey}.csv`, rows)
  }

  return (
    <div className="page-content">
      <div className="module-toolbar">
        <div className="reconcile-pill-wrap">
          <span
            className={`phx-badge ${recon.isReconciled ? "green" : "amber"}`}
          >
            <Icon name="circleCheck" size={14} />
            {recon.isReconciled
              ? `Ledger Reconciled · 0 UGX Variance (${monthKey})`
              : `Check Variance: ${ugx(recon.variance)}`}
          </span>
        </div>
        <div>
          <input
            type="month"
            className="month-picker-input"
            value={monthKey}
            onChange={(e) => e.target.value && setMonthKey(e.target.value)}
          />
          <button
            type="button"
            className="outline-btn"
            onClick={saveReportSnapshot}
          >
            Save Snapshot
          </button>
          <button
            type="button"
            className="outline-btn"
            onClick={exportMonthlyReportCsv}
          >
            <Icon name="download" size={16} /> Export CSV
          </button>
        </div>
      </div>

      {savedNotice && <div className="phx-alert success">{savedNotice}</div>}

      <div className="summary-strip">
        <div>
          <span>Eligible Personal Income</span>
          <strong className="tone-green">
            {ugxAbs(incSummary.totalEligiblePersonalIncome)}
          </strong>
          <small>Includes {ugxAbs(incSummary.ownerWithdrawals)} owner draws</small>
        </div>
        <div>
          <span>Personal Living Outflows</span>
          <strong>{ugxAbs(recon.personalLivingExpenses)}</strong>
          <small>+ {ugxAbs(recon.givingPaymentsOutflow)} giving paid</small>
        </div>
        <div>
          <span>Business Net Earnings</span>
          <strong>{ugx(incSummary.netBusinessEarnings)}</strong>
          <small>
            {ugxAbs(incSummary.businessGrossRevenue)} gross −{" "}
            {ugxAbs(incSummary.projectCosts)} costs
          </small>
        </div>
        <div>
          <span>Closing Personal Balance</span>
          <strong>{ugx(recon.actualClosingPersonalBalance)}</strong>
          <small>Variance: {ugx(recon.variance)}</small>
        </div>
      </div>

      <div className="dashboard-grid top-grid">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Consolidated Monthly Income Summary ({monthKey})</h2>
              <p>Every personal stream + excluded inflows separated cleanly</p>
            </div>
          </div>
          <div className="phx-table-wrap">
            <table className="phx-table">
              <thead>
                <tr>
                  <th>Income Stream / Classification</th>
                  <th>Amount (UGX)</th>
                </tr>
              </thead>
              <tbody>
                {ELIGIBLE_INCOME_TYPES.map((t) => (
                  <tr key={t.value}>
                    <td>{t.label}</td>
                    <td>{ugxAbs(incSummary.byStream[t.value])}</td>
                  </tr>
                ))}
                <tr className="summary-row">
                  <td>
                    <strong>Total Eligible Personal Income</strong>
                  </td>
                  <td className="tone-green">
                    <strong>
                      {ugxAbs(incSummary.totalEligiblePersonalIncome)}
                    </strong>
                  </td>
                </tr>
                <tr>
                  <td>Business Gross Revenue (Excluded from personal)</td>
                  <td>{ugxAbs(incSummary.businessGrossRevenue)}</td>
                </tr>
                <tr>
                  <td>Direct Project & Business Costs</td>
                  <td>{ugxAbs(incSummary.projectCosts)}</td>
                </tr>
                <tr>
                  <td>
                    Non-Income Inflows (Loans, Refunds, Reimbursements,
                    Transfers, Entrusted)
                  </td>
                  <td>{ugxAbs(incSummary.excludedNonIncomeInflows.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Ledger Reconciliation Proof ({monthKey})</h2>
              <p>Mathematical verification against raw transaction records</p>
            </div>
          </div>
          <div className="phx-table-wrap">
            <table className="phx-table">
              <tbody>
                <tr>
                  <td>Opening Personal Balance</td>
                  <td>{ugx(recon.openingPersonalBalance)}</td>
                </tr>
                <tr>
                  <td>+ Eligible Personal Income</td>
                  <td className="tone-green">
                    + {ugxAbs(recon.eligiblePersonalIncome)}
                  </td>
                </tr>
                <tr>
                  <td>+ Non-Income Personal Inflows</td>
                  <td>+ {ugxAbs(recon.nonIncomePersonalInflows)}</td>
                </tr>
                <tr>
                  <td>+ Personal Transfers In</td>
                  <td>+ {ugxAbs(recon.personalTransfersIn)}</td>
                </tr>
                <tr>
                  <td>− Personal Transfers Out</td>
                  <td>− {ugxAbs(recon.personalTransfersOut)}</td>
                </tr>
                <tr>
                  <td>− Personal Living Expenses</td>
                  <td>− {ugxAbs(recon.personalLivingExpenses)}</td>
                </tr>
                <tr>
                  <td>− Confirmed Giving Payments</td>
                  <td>− {ugxAbs(recon.givingPaymentsOutflow)}</td>
                </tr>
                <tr className="summary-row">
                  <td>
                    <strong>Closing Personal Account Balance</strong>
                  </td>
                  <td>
                    <strong>{ugx(recon.actualClosingPersonalBalance)}</strong>
                  </td>
                </tr>
                <tr>
                  <td>Duplicate Allocation Integrity Errors</td>
                  <td>{recon.duplicateAllocationErrors}</td>
                </tr>
                <tr>
                  <td>Orphaned Payment Integrity Errors</td>
                  <td>{recon.orphanedPaidAllocationErrors}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Individual Income-Source Report ({monthKey})</h2>
            <p>Per-source receipts, project costs, and giving reserved</p>
          </div>
        </div>
        <div className="phx-table-wrap">
          <table className="phx-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Records</th>
                <th>Personal Income</th>
                <th>Business Gross</th>
                <th>Project Costs</th>
                <th>Giving Reserved</th>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map((s) => (
                <tr key={s.sourceId}>
                  <td>
                    <strong>{s.sourceName}</strong>
                  </td>
                  <td>{s.transactionCount}</td>
                  <td>{ugxAbs(s.eligiblePersonalIncome)}</td>
                  <td>{ugxAbs(s.businessGrossRevenue)}</td>
                  <td>{ugxAbs(s.projectCosts)}</td>
                  <td>{ugxAbs(s.givingAllocated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {snapshot.financialReports.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Saved Monthly Report Snapshots</h2>
              <p>
                Stored in <code>users/{uid}/financial_reports</code>
              </p>
            </div>
          </div>
          <div className="phx-table-wrap">
            <table className="phx-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Personal Income</th>
                  <th>Personal Expenses</th>
                  <th>Giving Paid</th>
                  <th>Unallocated Available</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.financialReports.map((rep) => (
                  <tr key={rep.id}>
                    <td>
                      <strong>{rep.monthKey}</strong>
                    </td>
                    <td>{ugxAbs(rep.eligiblePersonalIncome)}</td>
                    <td>{ugxAbs(rep.personalExpenses)}</td>
                    <td>{ugxAbs(rep.givingPaid)}</td>
                    <td>{ugx(rep.unallocatedAvailable)}</td>
                    <td>
                      <span className="phx-badge green">
                        {rep.reconciled ? "Reconciled" : "Saved"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

