import { FormEvent, useMemo, useState } from "react"
import {
  deriveBalances,
  isEligiblePersonalIncomeType,
} from "../domain/ledgerEngine"
import {
  ELIGIBLE_INCOME_TYPES,
  EligibleIncomeType,
  GivingAllocation,
  IncomeClassification,
  LedgerTransaction,
  NON_ELIGIBLE_INFLOW_TYPES,
  UserFinancialSnapshot,
} from "../domain/types"
import {
  createUniqueId,
  defaultRepository,
} from "../services/phenaxisRepository"
import { Icon, IconName, ugx, ugxAbs } from "./Icons"

export type QuickAddTab =
  | "Income"
  | "Expense"
  | "Transfer"
  | "Entrusted"
  | "Task"
  | "Event"

export function QuickAddModal({
  uid,
  snapshot,
  initialTab = "Income",
  close,
}: {
  uid: string
  snapshot: UserFinancialSnapshot
  initialTab?: QuickAddTab
  close: () => void
}) {
  const [tab, setTab] = useState<QuickAddTab>(initialTab)
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    createUniqueId("idem"),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todayIso = new Date().toISOString().slice(0, 10)
  const balances = useMemo(() => deriveBalances(snapshot), [snapshot])

  const personalAccounts = useMemo(
    () => snapshot.accounts.filter((a) => !a.isArchived && a.type !== "business"),
    [snapshot.accounts],
  )
  const businessAccounts = useMemo(
    () => snapshot.accounts.filter((a) => !a.isArchived && a.type === "business"),
    [snapshot.accounts],
  )
  const allAccounts = useMemo(
    () => snapshot.accounts.filter((a) => !a.isArchived),
    [snapshot.accounts],
  )

  // Income state
  const [incType, setIncType] =
    useState<IncomeClassification>("employment_salary")
  const [incSourceId, setIncSourceId] = useState(
    snapshot.incomeSources[0]?.id ?? "",
  )
  const [addingNewSource, setAddingNewSource] = useState(false)
  const [newSourceName, setNewSourceName] = useState("")
  const [incAccountId, setIncAccountId] = useState(
    personalAccounts[0]?.id ?? allAccounts[0]?.id ?? "",
  )
  const [sourceBizAccountId, setSourceBizAccountId] = useState<string>(
    businessAccounts[0]?.id ?? "",
  )
  const [useInternalBizAccount, setUseInternalBizAccount] = useState(false)
  const [incTitle, setIncTitle] = useState("")
  const [incDescription, setIncDescription] = useState("")
  const [incAmount, setIncAmount] = useState("")
  const [incDate, setIncDate] = useState(todayIso)

  // Expense state
  const [isProjectCost, setIsProjectCost] = useState(false)
  const [expTitle, setExpTitle] = useState("")
  const [expDescription, setExpDescription] = useState("")
  const [expAmount, setExpAmount] = useState("")
  const [expDate, setExpDate] = useState(todayIso)
  const [expAccountId, setExpAccountId] = useState(
    personalAccounts[0]?.id ?? allAccounts[0]?.id ?? "",
  )
  const [expCategoryId, setExpCategoryId] = useState(
    snapshot.categories.find((c) => c.kind === "personal_expense")?.id ??
      snapshot.categories[0]?.id ??
      "",
  )
  const [expSourceId, setExpSourceId] = useState("")

  // Transfer state
  const [trfFromId, setTrfFromId] = useState(allAccounts[0]?.id ?? "")
  const [trfToId, setTrfToId] = useState(
    allAccounts[1]?.id ?? allAccounts[0]?.id ?? "",
  )
  const [trfAmount, setTrfAmount] = useState("")
  const [trfDate, setTrfDate] = useState(todayIso)
  const [trfDesc, setTrfDesc] = useState("")

  // Entrusted state
  const [entMode, setEntMode] = useState<"movement" | "new_fund">(
    snapshot.entrustedFunds.length === 0 ? "new_fund" : "movement",
  )
  const [entFundId, setEntFundId] = useState(
    snapshot.entrustedFunds[0]?.id ?? "",
  )
  const [entDirection, setEntDirection] = useState<"in" | "out">("in")
  const [entTitle, setEntTitle] = useState("")
  const [entAmount, setEntAmount] = useState("")
  const [entDate, setEntDate] = useState(todayIso)
  const [entDesc, setEntDesc] = useState("")

  const [newFundName, setNewFundName] = useState("")
  const [newFundStewardFor, setNewFundStewardFor] = useState("")
  const [newFundPurpose, setNewFundPurpose] = useState("")
  const [newFundColor, setNewFundColor] = useState<
    "violet" | "blue" | "amber" | "green" | "indigo"
  >("violet")

  // Task / Event state
  const [taskTitle, setTaskTitle] = useState("")
  const [taskMeta, setTaskMeta] = useState("Personal · Today")
  const [taskPriority, setTaskPriority] = useState<"High" | "Medium" | "Low">(
    "Medium",
  )
  const [taskDue, setTaskDue] = useState(todayIso)

  const [evtTitle, setEvtTitle] = useState("")
  const [evtDate, setEvtDate] = useState(todayIso)
  const [evtTime, setEvtTime] = useState("10:00")
  const [evtDuration, setEvtDuration] = useState("1 hour")
  const [evtScope, setEvtScope] = useState<
    "Personal" | "Work" | "Finance" | "Church"
  >("Personal")

  const switchTab = (next: QuickAddTab) => {
    setTab(next)
    setError(null)
    setIdempotencyKey(createUniqueId("idem"))
  }

  const numericIncome = Math.max(0, Math.round(Number(incAmount) || 0))
  const isEligible = isEligiblePersonalIncomeType(incType)
  const tithePreview = isEligible
    ? Math.round((numericIncome * snapshot.settings.tithePercent) / 100)
    : 0
  const thanksPreview = isEligible
    ? Math.round((numericIncome * snapshot.settings.thanksgivingPercent) / 100)
    : 0
  const seedPreview = isEligible
    ? Math.round((numericIncome * snapshot.settings.seedPercent) / 100)
    : 0
  const totalReservePreview = tithePreview + thanksPreview + seedPreview

  const handleIncomeTypeChange = (val: IncomeClassification) => {
    setIncType(val)
    if (val === "business_gross_revenue" && businessAccounts[0]) {
      setIncAccountId(businessAccounts[0].id)
      const bizSrc = snapshot.incomeSources.find((s) => s.isBusinessSource)
      if (bizSrc) setIncSourceId(bizSrc.id)
    } else if (
      val !== "business_gross_revenue" &&
      personalAccounts[0] &&
      businessAccounts.some((b) => b.id === incAccountId)
    ) {
      setIncAccountId(personalAccounts[0].id)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)

    try {
      const nowIso = new Date().toISOString()

      if (tab === "Income") {
        let resolvedSourceId = incSourceId
        if (addingNewSource && newSourceName.trim()) {
          const createdId = createUniqueId("src")
          await defaultRepository.saveEntity(uid, "income_sources", {
            id: createdId,
            ownerUid: uid,
            name: newSourceName.trim(),
            defaultIncomeType:
              incType === "business_gross_revenue"
                ? "business_gross_revenue"
                : isEligiblePersonalIncomeType(incType)
                  ? (incType as EligibleIncomeType)
                  : "other_income",
            isBusinessSource: incType === "business_gross_revenue",
            description: incDescription.trim() || "Custom income stream",
            active: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          resolvedSourceId = createdId
        }

        await defaultRepository.recordIncomeOrInflow(uid, {
          idempotencyKey,
          title: incTitle.trim(),
          description: incDescription.trim() || incTitle.trim(),
          amount: Number(incAmount),
          date: incDate,
          accountId: incAccountId,
          incomeSourceId: resolvedSourceId,
          incomeType: incType,
          sourceBusinessAccountId:
            incType === "owner_withdrawal" && useInternalBizAccount
              ? sourceBizAccountId
              : null,
        })
      } else if (tab === "Expense") {
        await defaultRepository.recordExpense(uid, {
          idempotencyKey,
          title: expTitle.trim(),
          description: expDescription.trim() || expTitle.trim(),
          amount: Number(expAmount),
          date: expDate,
          accountId: expAccountId,
          categoryId: isProjectCost ? "cat_project_cost" : expCategoryId,
          isProjectCost,
          incomeSourceId: expSourceId || null,
        })
      } else if (tab === "Transfer") {
        await defaultRepository.recordTransfer(uid, {
          idempotencyKey,
          amount: Number(trfAmount),
          date: trfDate,
          fromAccountId: trfFromId,
          toAccountId: trfToId,
          description: trfDesc.trim() || "Account transfer",
        })
      } else if (tab === "Entrusted") {
        if (entMode === "new_fund") {
          if (!newFundName.trim()) {
            throw new Error("Please enter a name for the entrusted fund.")
          }
          const fundId = createUniqueId("fund")
          await defaultRepository.saveEntity(uid, "entrusted_funds", {
            id: fundId,
            ownerUid: uid,
            name: newFundName.trim(),
            stewardFor: newFundStewardFor.trim() || "Custodial Beneficiary",
            purpose: newFundPurpose.trim() || "Ring-fenced entrusted purpose",
            icon: "shield",
            color: newFundColor,
            status: "active",
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          if (Number(entAmount) > 0) {
            await defaultRepository.recordEntrustedMovement(uid, {
              idempotencyKey,
              entrustedFundId: fundId,
              direction: "in",
              amount: Number(entAmount),
              date: entDate,
              title: `Initial receipt · ${newFundName.trim()}`,
              description: newFundPurpose.trim() || "Initial custodial deposit",
            })
          }
        } else {
          await defaultRepository.recordEntrustedMovement(uid, {
            idempotencyKey,
            entrustedFundId: entFundId,
            direction: entDirection,
            amount: Number(entAmount),
            date: entDate,
            title: entTitle.trim(),
            description: entDesc.trim() || entTitle.trim(),
          })
        }
      } else if (tab === "Task") {
        await defaultRepository.saveEntity(uid, "tasks", {
          id: createUniqueId("task"),
          ownerUid: uid,
          title: taskTitle.trim(),
          meta: taskMeta.trim() || "Personal",
          dueDate: taskDue,
          priority: taskPriority,
          done: false,
          projectId: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
      } else if (tab === "Event") {
        await defaultRepository.saveEntity(uid, "calendar_events", {
          id: createUniqueId("evt"),
          ownerUid: uid,
          title: evtTitle.trim(),
          date: evtDate,
          startTime: evtTime,
          durationLabel: evtDuration,
          scope: evtScope,
          color:
            evtScope === "Work"
              ? "amber"
              : evtScope === "Church"
                ? "violet"
                : evtScope === "Finance"
                  ? "green"
                  : "indigo",
          createdAt: nowIso,
          updatedAt: nowIso,
        })
      }

      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save record.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Quick add record"
      >
        <div className="modal-head">
          <div>
            <h2>Record to PHENAXIS</h2>
            <p>
              Atomic ledger write · Unique ID & idempotency protected
            </p>
          </div>
          <button className="icon-button" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="type-picker type-picker-6">
          {(
            [
              { n: "Income", i: "arrowDown" },
              { n: "Expense", i: "arrowUp" },
              { n: "Transfer", i: "swap" },
              { n: "Entrusted", i: "shield" },
              { n: "Task", i: "check" },
              { n: "Event", i: "calendar" },
            ] as { n: QuickAddTab; i: IconName }[]
          ).map((x) => (
            <button
              type="button"
              key={x.n}
              className={tab === x.n ? "active" : ""}
              onClick={() => switchTab(x.n)}
            >
              <Icon name={x.i} size={16} />
              <span>{x.n}</span>
            </button>
          ))}
        </div>

        {error && <div className="phx-alert error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {tab === "Income" && (
            <>
              <div className="form-row">
                <label>
                  Income / Inflow Classification
                  <select
                    value={incType}
                    onChange={(e) =>
                      handleIncomeTypeChange(
                        e.target.value as IncomeClassification,
                      )
                    }
                  >
                    <optgroup label="Eligible Personal Income (Auto-Giving)">
                      {ELIGIBLE_INCOME_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Business & Non-Income Inflows (0% Personal Giving)">
                      {NON_ELIGIBLE_INFLOW_TYPES.filter(
                        (t) =>
                          t.value !== "entrusted_inflow" &&
                          t.value !== "transfer",
                      ).map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>

                <label>
                  Date received
                  <input
                    type="date"
                    required
                    value={incDate}
                    onChange={(e) => setIncDate(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Amount (UGX)
                  <input
                    type="number"
                    required
                    min={1}
                    step={1}
                    placeholder="500000"
                    value={incAmount}
                    onChange={(e) => setIncAmount(e.target.value)}
                  />
                </label>

                <label>
                  Destination account
                  <select
                    value={incAccountId}
                    onChange={(e) => setIncAccountId(e.target.value)}
                  >
                    {allAccounts
                      .filter((a) =>
                        incType === "business_gross_revenue"
                          ? true
                          : a.type !== "business",
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({ugx(balances.accountBalances[a.id] ?? 0)})
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              {incType === "owner_withdrawal" && businessAccounts.length > 0 && (
                <div className="phx-subbox">
                  <label className="phx-inline-check">
                    <input
                      type="checkbox"
                      checked={useInternalBizAccount}
                      onChange={(e) =>
                        setUseInternalBizAccount(e.target.checked)
                      }
                    />
                    <span>
                      Deduct this Owner Withdrawal from an internal PHENAXIS
                      Business Account
                    </span>
                  </label>
                  {useInternalBizAccount && (
                    <label>
                      Source Business Account
                      <select
                        value={sourceBizAccountId}
                        onChange={(e) => setSourceBizAccountId(e.target.value)}
                      >
                        {businessAccounts.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} (Retained:{" "}
                            {ugx(balances.accountBalances[b.id] ?? 0)})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              <div className="form-row">
                <label>
                  Income source{" "}
                  <button
                    type="button"
                    className="inline-link"
                    onClick={() => setAddingNewSource((v) => !v)}
                  >
                    {addingNewSource ? "Choose existing" : "+ New source"}
                  </button>
                  {addingNewSource ? (
                    <input
                      required
                      placeholder="e.g. Acme Tech Ltd / Wedding Shoot"
                      value={newSourceName}
                      onChange={(e) => setNewSourceName(e.target.value)}
                    />
                  ) : (
                    <select
                      value={incSourceId}
                      onChange={(e) => setIncSourceId(e.target.value)}
                    >
                      {snapshot.incomeSources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </label>

                <label>
                  Record title
                  <input
                    required
                    placeholder="e.g. Monthly Salary / Milestone #2"
                    value={incTitle}
                    onChange={(e) => setIncTitle(e.target.value)}
                  />
                </label>
              </div>

              <label>
                Description & notes
                <input
                  required
                  placeholder="Source reference, invoice details, or payout period"
                  value={incDescription}
                  onChange={(e) => setIncDescription(e.target.value)}
                />
              </label>

              {isEligible ? (
                <div className="allocation-preview">
                  <div className="allocation-preview-head">
                    <Icon name="church" size={14} />
                    <strong>
                      Automatic Giving Allocation Engine (
                      {snapshot.settings.tithePercent +
                        snapshot.settings.thanksgivingPercent +
                        snapshot.settings.seedPercent}
                      %)
                    </strong>
                  </div>
                  <div className="allocation-preview-grid">
                    <span>
                      Tithe ({snapshot.settings.tithePercent}%)
                      <b>{ugxAbs(tithePreview)}</b>
                    </span>
                    <span>
                      Thanksgiving ({snapshot.settings.thanksgivingPercent}%)
                      <b>{ugxAbs(thanksPreview)}</b>
                    </span>
                    <span>
                      Seed ({snapshot.settings.seedPercent}%)
                      <b>{ugxAbs(seedPreview)}</b>
                    </span>
                    <span>
                      Total Reserved
                      <b>{ugxAbs(totalReservePreview)}</b>
                    </span>
                  </div>
                  {numericIncome > 0 && (
                    <small>
                      Creates 3 linked unpaid obligations · Unallocated net from
                      this income:{" "}
                      <strong>
                        {ugxAbs(Math.max(0, numericIncome - totalReservePreview))}
                      </strong>
                    </small>
                  )}
                </div>
              ) : (
                <div className="notice">
                  <Icon name="shield" size={15} />
                  <span>
                    {incType === "business_gross_revenue"
                      ? "Business gross revenue is NOT classified as personal income. Record Project Costs against it, and use Business Owner Withdrawal when drawing personal pay."
                      : "Excluded non-income inflow (reimbursement, refund, loan, or opening balance): increases account balance with zero giving allocation."}
                  </span>
                </div>
              )}
            </>
          )}

          {tab === "Expense" && (
            <>
              <div className="phx-toggle-bar">
                <button
                  type="button"
                  className={!isProjectCost ? "active" : ""}
                  onClick={() => setIsProjectCost(false)}
                >
                  Personal Living Expense
                </button>
                <button
                  type="button"
                  className={isProjectCost ? "active" : ""}
                  onClick={() => {
                    setIsProjectCost(true)
                    if (businessAccounts[0]) {
                      setExpAccountId(businessAccounts[0].id)
                    }
                  }}
                >
                  Business / Project Cost
                </button>
              </div>

              <div className="form-row">
                <label>
                  {isProjectCost ? "Project / business cost title" : "Expense title"}
                  <input
                    required
                    placeholder={
                      isProjectCost
                        ? "e.g. Server hosting / Subcontractor fee"
                        : "e.g. Quality Supermarket groceries"
                    }
                    value={expTitle}
                    onChange={(e) => setExpTitle(e.target.value)}
                  />
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    required
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Amount (UGX)
                  <input
                    type="number"
                    required
                    min={1}
                    placeholder="150000"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                  />
                </label>
                <label>
                  Pay from account
                  <select
                    value={expAccountId}
                    onChange={(e) => setExpAccountId(e.target.value)}
                  >
                    {allAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({ugx(balances.accountBalances[a.id] ?? 0)})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="form-row">
                {!isProjectCost ? (
                  <label>
                    Budget category
                    <select
                      value={expCategoryId}
                      onChange={(e) => setExpCategoryId(e.target.value)}
                    >
                      {snapshot.categories
                        .filter((c) => c.kind === "personal_expense")
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    Link to Business / Income Source
                    <select
                      value={expSourceId}
                      onChange={(e) => setExpSourceId(e.target.value)}
                    >
                      <option value="">General Business Cost</option>
                      {snapshot.incomeSources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Description
                  <input
                    placeholder="Receipt or vendor details"
                    value={expDescription}
                    onChange={(e) => setExpDescription(e.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          {tab === "Transfer" && (
            <>
              <div className="notice">
                <Icon name="swap" size={15} />
                <span>
                  Atomic linked transfer moves money between your accounts with{" "}
                  <strong>zero new income</strong> and{" "}
                  <strong>zero giving allocation</strong>.
                </span>
              </div>
              <div className="form-row">
                <label>
                  From account
                  <select
                    value={trfFromId}
                    onChange={(e) => setTrfFromId(e.target.value)}
                  >
                    {allAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({ugx(balances.accountBalances[a.id] ?? 0)})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  To account
                  <select
                    value={trfToId}
                    onChange={(e) => setTrfToId(e.target.value)}
                  >
                    {allAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({ugx(balances.accountBalances[a.id] ?? 0)})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label>
                  Amount (UGX)
                  <input
                    type="number"
                    required
                    min={1}
                    placeholder="250000"
                    value={trfAmount}
                    onChange={(e) => setTrfAmount(e.target.value)}
                  />
                </label>
                <label>
                  Transfer date
                  <input
                    type="date"
                    required
                    value={trfDate}
                    onChange={(e) => setTrfDate(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Notes
                <input
                  placeholder="e.g. Top up MTN MoMo wallet from Stanbic"
                  value={trfDesc}
                  onChange={(e) => setTrfDesc(e.target.value)}
                />
              </label>
            </>
          )}

          {tab === "Entrusted" && (
            <>
              <div className="notice">
                <Icon name="shield" size={15} />
                <span>
                  Entrusted funds are strictly separated from your personal
                  balance and create zero personal giving allocations.
                </span>
              </div>
              <div className="phx-toggle-bar">
                <button
                  type="button"
                  className={entMode === "movement" ? "active" : ""}
                  onClick={() => setEntMode("movement")}
                  disabled={snapshot.entrustedFunds.length === 0}
                >
                  Record Fund Receipt / Disbursement
                </button>
                <button
                  type="button"
                  className={entMode === "new_fund" ? "active" : ""}
                  onClick={() => setEntMode("new_fund")}
                >
                  + Create New Entrusted Fund
                </button>
              </div>

              {entMode === "new_fund" ? (
                <>
                  <div className="form-row">
                    <label>
                      Entrusted fund name
                      <input
                        required
                        placeholder="e.g. Church Youth Camp"
                        value={newFundName}
                        onChange={(e) => setNewFundName(e.target.value)}
                      />
                    </label>
                    <label>
                      Stewarding on behalf of
                      <input
                        required
                        placeholder="e.g. Youth Ministry Committee"
                        value={newFundStewardFor}
                        onChange={(e) => setNewFundStewardFor(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      Initial custodial receipt (UGX, optional)
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={entAmount}
                        onChange={(e) => setEntAmount(e.target.value)}
                      />
                    </label>
                    <label>
                      Accent color
                      <select
                        value={newFundColor}
                        onChange={(e) =>
                          setNewFundColor(
                            e.target.value as typeof newFundColor,
                          )
                        }
                      >
                        <option value="violet">Violet</option>
                        <option value="blue">Blue</option>
                        <option value="amber">Amber</option>
                        <option value="green">Green</option>
                        <option value="indigo">Indigo</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Purpose & accountability terms
                    <input
                      placeholder="e.g. Camp transport, meals, and venue fees"
                      value={newFundPurpose}
                      onChange={(e) => setNewFundPurpose(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="form-row">
                    <label>
                      Entrusted fund
                      <select
                        value={entFundId}
                        onChange={(e) => setEntFundId(e.target.value)}
                      >
                        {snapshot.entrustedFunds.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} (Rem:{" "}
                            {ugx(
                              balances.entrustedFundSummaries[f.id]
                                ?.remaining ?? 0,
                            )}
                            )
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Movement type
                      <select
                        value={entDirection}
                        onChange={(e) =>
                          setEntDirection(e.target.value as "in" | "out")
                        }
                      >
                        <option value="in">Custodial Receipt (+ Inflow)</option>
                        <option value="out">
                          Custodial Disbursement (− Outflow)
                        </option>
                      </select>
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      Amount (UGX)
                      <input
                        type="number"
                        required
                        min={1}
                        placeholder="320000"
                        value={entAmount}
                        onChange={(e) => setEntAmount(e.target.value)}
                      />
                    </label>
                    <label>
                      Date
                      <input
                        type="date"
                        required
                        value={entDate}
                        onChange={(e) => setEntDate(e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Activity title
                    <input
                      required
                      placeholder="e.g. Youth Camp Supplies"
                      value={entTitle}
                      onChange={(e) => setEntTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    Accountability note
                    <input
                      placeholder="Voucher / receipt reference"
                      value={entDesc}
                      onChange={(e) => setEntDesc(e.target.value)}
                    />
                  </label>
                </>
              )}
            </>
          )}

          {tab === "Task" && (
            <>
              <label>
                Task title
                <input
                  required
                  placeholder="e.g. Review monthly giving obligations"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
              </label>
              <div className="form-row">
                <label>
                  Priority
                  <select
                    value={taskPriority}
                    onChange={(e) =>
                      setTaskPriority(
                        e.target.value as "High" | "Medium" | "Low",
                      )
                    }
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={taskDue}
                    onChange={(e) => setTaskDue(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Context / Time tag
                <input
                  placeholder="e.g. Finance · 10:00 AM"
                  value={taskMeta}
                  onChange={(e) => setTaskMeta(e.target.value)}
                />
              </label>
            </>
          )}

          {tab === "Event" && (
            <>
              <label>
                Event / Time block title
                <input
                  required
                  placeholder="e.g. Client milestone review"
                  value={evtTitle}
                  onChange={(e) => setEvtTitle(e.target.value)}
                />
              </label>
              <div className="form-row">
                <label>
                  Date
                  <input
                    type="date"
                    required
                    value={evtDate}
                    onChange={(e) => setEvtDate(e.target.value)}
                  />
                </label>
                <label>
                  Start time
                  <input
                    type="time"
                    required
                    value={evtTime}
                    onChange={(e) => setEvtTime(e.target.value)}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Duration
                  <input
                    value={evtDuration}
                    onChange={(e) => setEvtDuration(e.target.value)}
                  />
                </label>
                <label>
                  Area
                  <select
                    value={evtScope}
                    onChange={(e) =>
                      setEvtScope(e.target.value as typeof evtScope)
                    }
                  >
                    <option value="Personal">Personal</option>
                    <option value="Work">Work</option>
                    <option value="Finance">Finance</option>
                    <option value="Church">Church</option>
                  </select>
                </label>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="outline-btn" onClick={close}>
              Cancel
            </button>
            <button className="quick-add" type="submit" disabled={busy}>
              <Icon name="plus" size={16} />
              <span>{busy ? "Saving..." : `Save ${tab}`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function PayAllocationModal({
  uid,
  allocation,
  snapshot,
  close,
}: {
  uid: string
  allocation: GivingAllocation
  snapshot: UserFinancialSnapshot
  close: () => void
}) {
  const balances = useMemo(() => deriveBalances(snapshot), [snapshot])
  const personalAccounts = useMemo(
    () => snapshot.accounts.filter((a) => !a.isArchived && a.type !== "business"),
    [snapshot.accounts],
  )
  const [accountId, setAccountId] = useState(personalAccounts[0]?.id ?? "")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState("")
  const [idempotencyKey] = useState(() => createUniqueId("idem_pay"))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await defaultRepository.payAllocation(uid, {
        idempotencyKey,
        allocationId: allocation.id,
        paidFromAccountId: accountId,
        date,
        notes,
      })
      close()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to confirm payment.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>Confirm Giving Payment</h2>
            <p>
              Closes obligation and deducts account balance once without
              double-counting
            </p>
          </div>
          <button className="icon-button" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div className="allocation-preview" style={{ margin: "16px 0" }}>
          <div className="allocation-preview-head">
            <Icon name="church" size={14} />
            <strong>
              {allocation.label} ({allocation.percentage}%) ·{" "}
              {allocation.sourceTransactionTitle}
            </strong>
          </div>
          <div className="allocation-preview-grid">
            <span>
              Obligation Amount
              <b>{ugxAbs(allocation.amount)}</b>
            </span>
            <span>
              Source Income
              <b>{ugxAbs(allocation.baseIncomeAmount)}</b>
            </span>
            <span>
              Income Source
              <b>{allocation.incomeSourceName}</b>
            </span>
            <span>
              Income Date
              <b>{allocation.incomeDate}</b>
            </span>
          </div>
        </div>

        {error && <div className="phx-alert error">{error}</div>}

        <form onSubmit={submit}>
          <div className="form-row">
            <label>
              Pay from personal account
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {personalAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({ugx(balances.accountBalances[a.id] ?? 0)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Payment date
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <label>
            Payment reference / church / ministry note
            <input
              placeholder="e.g. Sunday service / Mobile Money ref"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="outline-btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="quick-add" disabled={busy}>
              <Icon name="circleCheck" size={16} />
              <span>
                {busy ? "Recording..." : `Confirm ${ugxAbs(allocation.amount)}`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function TransactionAuditModal({
  uid,
  transaction,
  snapshot,
  close,
}: {
  uid: string
  transaction: LedgerTransaction
  snapshot: UserFinancialSnapshot
  close: () => void
}) {
  const [title, setTitle] = useState(transaction.title)
  const [amount, setAmount] = useState(String(transaction.amount))
  const [date, setDate] = useState(transaction.date)
  const [description, setDescription] = useState(transaction.description)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const linkedAllocs = useMemo(
    () =>
      snapshot.allocations.filter(
        (a) => a.sourceTransactionId === transaction.id,
      ),
    [snapshot.allocations, transaction.id],
  )

  const canModify =
    transaction.status !== "voided" &&
    transaction.kind !== "allocation_payment"

  const handleCorrect = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await defaultRepository.correctTransaction(uid, {
        transactionId: transaction.id,
        newTitle: title,
        newAmount: Number(amount),
        newDate: date,
        newDescription: description,
        reason,
      })
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Correction failed.")
    } finally {
      setBusy(false)
    }
  }

  const handleVoid = async () => {
    if (!reason.trim()) {
      setError("Please enter an audit reason before voiding this record.")
      return
    }
    setError(null)
    setBusy(true)
    try {
      await defaultRepository.voidTransaction(uid, {
        transactionId: transaction.id,
        reason,
      })
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Void operation failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal modal-wide" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>Transaction Audit & Correction</h2>
            <p>
              ID: <code>{transaction.id}</code> · Status:{" "}
              <strong>{transaction.status.toUpperCase()}</strong>
            </p>
          </div>
          <button className="icon-button" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div className="phx-meta-strip">
          <span>
            Kind: <b>{transaction.kind.replace(/_/g, " ")}</b>
          </span>
          <span>
            Account: <b>{transaction.accountName}</b>
          </span>
          {transaction.incomeSourceName && (
            <span>
              Source: <b>{transaction.incomeSourceName}</b>
            </span>
          )}
          <span>
            Idempotency: <code>{transaction.idempotencyKey}</code>
          </span>
        </div>

        {linkedAllocs.length > 0 && (
          <div className="allocation-preview" style={{ marginBottom: 12 }}>
            <div className="allocation-preview-head">
              <Icon name="church" size={14} />
              <strong>Linked Giving Allocations ({linkedAllocs.length})</strong>
            </div>
            <div className="allocation-preview-grid">
              {linkedAllocs.map((a) => (
                <span key={a.id}>
                  {a.label} ({a.percentage}%) · {a.status}
                  <b>{ugxAbs(a.amount)}</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {error && <div className="phx-alert error">{error}</div>}

        {canModify && (
          <form onSubmit={handleCorrect}>
            <div className="form-row">
              <label>
                Title
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Amount (UGX)
                <input
                  type="number"
                  required
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Date
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Description
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            </div>
            <label>
              Audit reason for correction or void (required)
              <input
                required
                placeholder="e.g. Corrected bank slip amount / Duplicate manual entry"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="outline-btn danger-outline"
                onClick={handleVoid}
                disabled={busy}
              >
                Void record
              </button>
              <button type="submit" className="quick-add" disabled={busy}>
                <Icon name="edit" size={15} />
                <span>Save auditable correction</span>
              </button>
            </div>
          </form>
        )}

        {!canModify && transaction.status !== "voided" && (
          <div className="phx-subbox" style={{ marginTop: 10 }}>
            <label>
              Audit reason to reverse/void this allocation payment (reopens
              obligation)
              <input
                placeholder="Enter reason if payment was recorded in error"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="outline-btn danger-outline"
                onClick={handleVoid}
                disabled={busy}
              >
                Void payment & reopen obligation
              </button>
            </div>
          </div>
        )}

        <div className="audit-trail-box">
          <strong>Immutable Audit Trail ({transaction.auditTrail.length})</strong>
          {transaction.auditTrail.map((entry, idx) => (
            <div className="audit-entry" key={`${entry.timestamp}_${idx}`}>
              <span>
                <b>{entry.action.toUpperCase()}</b> ·{" "}
                {entry.timestamp.slice(0, 19).replace("T", " ")}
              </span>
              <p>
                {entry.reason}
                {entry.previousAmount !== undefined &&
                  entry.newAmount !== undefined &&
                  ` (${ugxAbs(entry.previousAmount)} → ${ugxAbs(entry.newAmount)})`}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

