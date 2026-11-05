import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  setDoc,
  writeBatch,
} from "firebase/firestore"
import {
  buildGivingAllocationsForIncome,
  buildTransactionFingerprint,
  deterministicAllocationId,
  isEligiblePersonalIncomeType,
  toMonthKey,
} from "../domain/ledgerEngine"
import {
  Account,
  AccountType,
  Budget,
  CalendarEvent,
  Category,
  EligibleIncomeType,
  EntrustedFund,
  FinancialReportSnapshot,
  GivingAllocation,
  IncomeClassification,
  IncomeSource,
  LedgerTransaction,
  NonIncomeInflowType,
  ProjectItem,
  RecurringExpense,
  SavingsGoal,
  TaskItem,
  USER_COLLECTIONS,
  UserCollectionName,
  UserFinancialSnapshot,
  UserSettings,
} from "../domain/types"
import { getFirebaseRuntime } from "./firebaseClient"

export interface KeyValuePersistence {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

class MemoryPersistence implements KeyValuePersistence {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

const defaultBrowserPersistence: KeyValuePersistence =
  typeof window !== "undefined" && window.localStorage
    ? window.localStorage
    : new MemoryPersistence()

export function createUniqueId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `${prefix}_${rand}`
}

export interface RecordIncomeInput {
  idempotencyKey: string
  title: string
  description: string
  amount: number
  date: string // YYYY-MM-DD
  accountId: string
  incomeSourceId: string
  incomeType: IncomeClassification
  /**
   * Optional: When recording an owner_withdrawal drawn from an internal Business account,
   * specifying sourceBusinessAccountId atomically debits the business account and credits the personal account.
   */
  sourceBusinessAccountId?: string | null
  /**
   * Optional: Pass-through or direct project cost paid simultaneously from business/account
   */
  projectId?: string | null
  allowDuplicateFingerprint?: boolean
}

export interface RecordExpenseInput {
  idempotencyKey: string
  title: string
  description: string
  amount: number
  date: string
  accountId: string
  categoryId: string
  isProjectCost?: boolean
  incomeSourceId?: string | null
  projectId?: string | null
  recurringExpenseId?: string | null
  allowDuplicateFingerprint?: boolean
}

export interface RecordTransferInput {
  idempotencyKey: string
  amount: number
  date: string
  fromAccountId: string
  toAccountId: string
  description: string
}

export interface PayAllocationInput {
  idempotencyKey: string
  allocationId: string
  paidFromAccountId: string
  date: string
  notes?: string
}

export interface RecordEntrustedMovementInput {
  idempotencyKey: string
  entrustedFundId: string
  direction: "in" | "out"
  amount: number
  date: string
  title: string
  description: string
}

export interface RecordSavingsMovementInput {
  idempotencyKey: string
  savingsGoalId: string
  direction: "deposit" | "withdrawal"
  amount: number
  date: string
  accountId: string | null
  notes: string
}

export interface CorrectTransactionInput {
  transactionId: string
  newAmount: number
  newTitle: string
  newDescription: string
  newDate: string
  reason: string
}

export interface VoidTransactionInput {
  transactionId: string
  reason: string
}

function buildDefaultSettings(uid: string, displayName: string, nowIso: string): UserSettings {
  return {
    id: "preferences",
    ownerUid: uid,
    displayName: displayName || "PHENAXIS Steward",
    currency: "UGX",
    tithePercent: 10,
    thanksgivingPercent: 5,
    seedPercent: 5,
    updatedAt: nowIso,
  }
}

function buildStarterAccounts(uid: string, nowIso: string): Account[] {
  const defs: {
    id: string
    name: string
    type: AccountType
    institution: string
    color: Account["color"]
    icon: string
  }[] = [
    {
      id: "acc_stanbic",
      name: "Stanbic Bank",
      type: "bank",
      institution: "Stanbic Bank Uganda",
      color: "indigo",
      icon: "bank",
    },
    {
      id: "acc_mtn_momo",
      name: "MTN MoMo",
      type: "mobile_money",
      institution: "MTN Mobile Money",
      color: "amber",
      icon: "wallet",
    },
    {
      id: "acc_airtel_money",
      name: "Airtel Money",
      type: "mobile_money",
      institution: "Airtel Money",
      color: "blue",
      icon: "wallet",
    },
    {
      id: "acc_cash_wallet",
      name: "Cash Wallet",
      type: "cash",
      institution: "Physical Cash",
      color: "green",
      icon: "wallet",
    },
    {
      id: "acc_business_ops",
      name: "Business Operating",
      type: "business",
      institution: "Business Revenue & Costs",
      color: "violet",
      icon: "briefcase",
    },
  ]
  return defs.map((d) => ({
    ...d,
    ownerUid: uid,
    currency: "UGX",
    isArchived: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  }))
}

function buildStarterCategories(uid: string, nowIso: string): Category[] {
  const defs: Omit<Category, "ownerUid" | "createdAt" | "updatedAt">[] = [
    { id: "cat_housing", name: "Housing & Rent", kind: "personal_expense", color: "indigo", icon: "bank" },
    { id: "cat_food", name: "Food & Groceries", kind: "personal_expense", color: "amber", icon: "wallet" },
    { id: "cat_transport", name: "Transport & Fuel", kind: "personal_expense", color: "blue", icon: "swap" },
    { id: "cat_utilities", name: "Utilities & Internet", kind: "personal_expense", color: "violet", icon: "clock" },
    { id: "cat_personal", name: "Personal & Family", kind: "personal_expense", color: "pink", icon: "check" },
    { id: "cat_project_cost", name: "Project & Business Costs", kind: "business_cost", color: "amber", icon: "briefcase" },
    { id: "cat_giving", name: "Tithe, Thanksgiving & Seed", kind: "giving", color: "green", icon: "church" },
  ]
  return defs.map((c) => ({ ...c, ownerUid: uid, createdAt: nowIso, updatedAt: nowIso }))
}

function buildStarterIncomeSources(uid: string, nowIso: string): IncomeSource[] {
  const defs: Omit<IncomeSource, "ownerUid" | "createdAt" | "updatedAt">[] = [
    {
      id: "src_employment",
      name: "Primary Employment",
      defaultIncomeType: "employment_salary",
      isBusinessSource: false,
      description: "Monthly employment salary & bonuses",
      active: true,
    },
    {
      id: "src_freelance",
      name: "Freelance & Client Projects",
      defaultIncomeType: "freelance_earnings",
      isBusinessSource: false,
      description: "Direct freelance & technical engagements",
      active: true,
    },
    {
      id: "src_creative",
      name: "Creative & Technical Services",
      defaultIncomeType: "creative_technical_services",
      isBusinessSource: false,
      description: "Design, software & consulting services",
      active: true,
    },
    {
      id: "src_ministry",
      name: "Ministry & Honoraria",
      defaultIncomeType: "ministry_allowances",
      isBusinessSource: false,
      description: "Ministry allowances and stipends",
      active: true,
    },
    {
      id: "src_business",
      name: "Business Venture",
      defaultIncomeType: "business_gross_revenue",
      isBusinessSource: true,
      description: "Gross business receipts (withdrawals tracked separately)",
      active: true,
    },
  ]
  return defs.map((s) => ({ ...s, ownerUid: uid, createdAt: nowIso, updatedAt: nowIso }))
}

function buildStarterBudgets(uid: string, nowIso: string): Budget[] {
  return [
    {
      id: "bud_housing",
      ownerUid: uid,
      categoryId: "cat_housing",
      categoryName: "Housing & Rent",
      monthKey: "default",
      limitAmount: 1200000,
      color: "indigo",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: "bud_food",
      ownerUid: uid,
      categoryId: "cat_food",
      categoryName: "Food & Groceries",
      monthKey: "default",
      limitAmount: 650000,
      color: "amber",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: "bud_transport",
      ownerUid: uid,
      categoryId: "cat_transport",
      categoryName: "Transport & Fuel",
      monthKey: "default",
      limitAmount: 500000,
      color: "blue",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: "bud_personal",
      ownerUid: uid,
      categoryId: "cat_personal",
      categoryName: "Personal & Family",
      monthKey: "default",
      limitAmount: 350000,
      color: "pink",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ]
}

/**
 * PHENAXIS Cloud & Vault Repository
 * Strictly organizes all records under `users/{uid}/{collection}/{docId}`.
 * Enforces user-level authentication boundaries, atomic writes, idempotency, and auditability.
 */
export class PhenaxisRepository {
  private persistence: KeyValuePersistence
  private forceLocalVault: boolean
  private listeners = new Map<string, Set<(snap: UserFinancialSnapshot) => void>>()
  private activeUidGetter: () => string | null

  constructor(options?: {
    persistence?: KeyValuePersistence
    forceLocalVault?: boolean
    getAuthenticatedUid?: () => string | null
  }) {
    this.persistence = options?.persistence ?? defaultBrowserPersistence
    this.forceLocalVault = options?.forceLocalVault ?? false
    this.activeUidGetter = options?.getAuthenticatedUid ?? (() => null)
  }

  public setAuthenticatedUidResolver(fn: () => string | null): void {
    this.activeUidGetter = fn
  }

  private assertAuthorized(targetUid: string): void {
    if (!targetUid || !targetUid.trim()) {
      throw new Error("UNAUTHENTICATED: Valid user UID is required.")
    }
    const currentUid = this.activeUidGetter()
    if (!currentUid) {
      throw new Error("UNAUTHENTICATED: Please sign in to access financial records.")
    }
    if (currentUid !== targetUid) {
      throw new Error(
        `PERMISSION_DENIED: Authenticated user (${currentUid}) cannot access records under users/${targetUid}.`,
      )
    }
  }

  private isCloudMode(): boolean {
    if (this.forceLocalVault) return false
    return getFirebaseRuntime().mode === "firebase_cloud"
  }

  private localCollectionKey(uid: string, col: UserCollectionName): string {
    return `phenaxis:db:users/${uid}/${col}`
  }

  private readLocalCol<T extends { id: string }>(
    uid: string,
    col: UserCollectionName,
  ): T[] {
    const raw = this.persistence.getItem(this.localCollectionKey(uid, col))
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }

  private writeLocalCol<T extends { id: string }>(
    uid: string,
    col: UserCollectionName,
    docs: T[],
  ): void {
    this.persistence.setItem(
      this.localCollectionKey(uid, col),
      JSON.stringify(docs),
    )
  }

  private notifyLocalSubscribers(uid: string): void {
    const subs = this.listeners.get(uid)
    if (!subs || subs.size === 0) return
    const snap = this.readLocalSnapshotInternal(uid)
    for (const cb of subs) {
      cb(snap)
    }
  }

  private readLocalSnapshotInternal(uid: string): UserFinancialSnapshot {
    const settingsList = this.readLocalCol<UserSettings>(uid, "settings")
    const settings =
      settingsList.find((s) => s.id === "preferences") ??
      buildDefaultSettings(uid, "PHENAXIS User", new Date().toISOString())

    return {
      uid,
      accounts: this.readLocalCol<Account>(uid, "accounts"),
      transactions: this.readLocalCol<LedgerTransaction>(uid, "transactions").sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
      ),
      incomeSources: this.readLocalCol<IncomeSource>(uid, "income_sources"),
      categories: this.readLocalCol<Category>(uid, "categories"),
      allocations: this.readLocalCol<GivingAllocation>(uid, "allocations").sort(
        (a, b) =>
          b.incomeDate.localeCompare(a.incomeDate) ||
          a.allocationType.localeCompare(b.allocationType),
      ),
      budgets: this.readLocalCol<Budget>(uid, "budgets"),
      entrustedFunds: this.readLocalCol<EntrustedFund>(uid, "entrusted_funds"),
      savingsGoals: this.readLocalCol<SavingsGoal>(uid, "savings_goals"),
      recurringExpenses: this.readLocalCol<RecurringExpense>(
        uid,
        "recurring_expenses",
      ),
      tasks: this.readLocalCol<TaskItem>(uid, "tasks"),
      projects: this.readLocalCol<ProjectItem>(uid, "projects"),
      calendarEvents: this.readLocalCol<CalendarEvent>(uid, "calendar_events"),
      financialReports: this.readLocalCol<FinancialReportSnapshot>(
        uid,
        "financial_reports",
      ),
      settings,
    }
  }

  public async getSnapshot(uid: string): Promise<UserFinancialSnapshot> {
    this.assertAuthorized(uid)

    if (!this.isCloudMode()) {
      return this.readLocalSnapshotInternal(uid)
    }

    const db = getFirebaseRuntime().db!
    const fetchCol = async <T>(col: UserCollectionName): Promise<T[]> => {
      const snap = await getDocs(collection(db, "users", uid, col))
      return snap.docs.map((d) => d.data() as T)
    }

    const [
      accounts,
      transactions,
      incomeSources,
      categories,
      allocations,
      budgets,
      entrustedFunds,
      savingsGoals,
      recurringExpenses,
      tasks,
      projects,
      calendarEvents,
      financialReports,
      settingsDocs,
    ] = await Promise.all([
      fetchCol<Account>("accounts"),
      fetchCol<LedgerTransaction>("transactions"),
      fetchCol<IncomeSource>("income_sources"),
      fetchCol<Category>("categories"),
      fetchCol<GivingAllocation>("allocations"),
      fetchCol<Budget>("budgets"),
      fetchCol<EntrustedFund>("entrusted_funds"),
      fetchCol<SavingsGoal>("savings_goals"),
      fetchCol<RecurringExpense>("recurring_expenses"),
      fetchCol<TaskItem>("tasks"),
      fetchCol<ProjectItem>("projects"),
      fetchCol<CalendarEvent>("calendar_events"),
      fetchCol<FinancialReportSnapshot>("financial_reports"),
      fetchCol<UserSettings>("settings"),
    ])

    const settings =
      settingsDocs.find((s) => s.id === "preferences") ??
      buildDefaultSettings(uid, "PHENAXIS User", new Date().toISOString())

    return {
      uid,
      accounts,
      transactions: transactions.sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
      ),
      incomeSources,
      categories,
      allocations: allocations.sort(
        (a, b) =>
          b.incomeDate.localeCompare(a.incomeDate) ||
          a.allocationType.localeCompare(b.allocationType),
      ),
      budgets,
      entrustedFunds,
      savingsGoals,
      recurringExpenses,
      tasks,
      projects,
      calendarEvents,
      financialReports,
      settings,
    }
  }

  public subscribe(
    uid: string,
    callback: (snapshot: UserFinancialSnapshot) => void,
  ): () => void {
    this.assertAuthorized(uid)

    if (!this.isCloudMode()) {
      if (!this.listeners.has(uid)) {
        this.listeners.set(uid, new Set())
      }
      this.listeners.get(uid)!.add(callback)
      callback(this.readLocalSnapshotInternal(uid))
      return () => {
        this.listeners.get(uid)?.delete(callback)
      }
    }

    const db = getFirebaseRuntime().db!
    const cache: Partial<Record<UserCollectionName, unknown[]>> = {}

    const emit = () => {
      const settingsDocs = (cache.settings as UserSettings[] | undefined) ?? []
      const settings =
        settingsDocs.find((s) => s.id === "preferences") ??
        buildDefaultSettings(uid, "PHENAXIS User", new Date().toISOString())

      const txList = ((cache.transactions as LedgerTransaction[]) ?? []).slice().sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
      )
      const allocList = ((cache.allocations as GivingAllocation[]) ?? [])
        .slice()
        .sort(
          (a, b) =>
            b.incomeDate.localeCompare(a.incomeDate) ||
            a.allocationType.localeCompare(b.allocationType),
        )

      callback({
        uid,
        accounts: (cache.accounts as Account[]) ?? [],
        transactions: txList,
        incomeSources: (cache.income_sources as IncomeSource[]) ?? [],
        categories: (cache.categories as Category[]) ?? [],
        allocations: allocList,
        budgets: (cache.budgets as Budget[]) ?? [],
        entrustedFunds: (cache.entrusted_funds as EntrustedFund[]) ?? [],
        savingsGoals: (cache.savings_goals as SavingsGoal[]) ?? [],
        recurringExpenses: (cache.recurring_expenses as RecurringExpense[]) ?? [],
        tasks: (cache.tasks as TaskItem[]) ?? [],
        projects: (cache.projects as ProjectItem[]) ?? [],
        calendarEvents: (cache.calendar_events as CalendarEvent[]) ?? [],
        financialReports:
          (cache.financial_reports as FinancialReportSnapshot[]) ?? [],
        settings,
      })
    }

    const unsubs = USER_COLLECTIONS.map((colName) =>
      onSnapshot(collection(db, "users", uid, colName), (snap) => {
        cache[colName] = snap.docs.map((d) => d.data())
        emit()
      }),
    )

    return () => {
      unsubs.forEach((u) => u())
    }
  }

  /**
   * Initializes starter structure (accounts with 0 balance, categories, income sources, default 10/5/5% settings)
   * without adding artificial balances or fake transactions.
   */
  public async ensureUserInitialized(
    uid: string,
    displayName: string,
  ): Promise<void> {
    this.assertAuthorized(uid)
    const nowIso = new Date().toISOString()
    const snap = await this.getSnapshot(uid)

    const needsSettings = !snap.settings || !snap.settings.updatedAt
    const needsAccounts = snap.accounts.length === 0
    const needsCategories = snap.categories.length === 0
    const needsSources = snap.incomeSources.length === 0
    const needsBudgets = snap.budgets.length === 0

    if (
      !needsSettings &&
      !needsAccounts &&
      !needsCategories &&
      !needsSources &&
      !needsBudgets
    ) {
      return
    }

    const starterSettings = buildDefaultSettings(uid, displayName, nowIso)
    const starterAccounts = needsAccounts ? buildStarterAccounts(uid, nowIso) : []
    const starterCategories = needsCategories
      ? buildStarterCategories(uid, nowIso)
      : []
    const starterSources = needsSources
      ? buildStarterIncomeSources(uid, nowIso)
      : []
    const starterBudgets = needsBudgets ? buildStarterBudgets(uid, nowIso) : []

    if (!this.isCloudMode()) {
      const existingSettings = this.readLocalCol<UserSettings>(uid, "settings")
      if (existingSettings.length === 0) {
        this.writeLocalCol(uid, "settings", [starterSettings])
      }
      if (needsAccounts) this.writeLocalCol(uid, "accounts", starterAccounts)
      if (needsCategories)
        this.writeLocalCol(uid, "categories", starterCategories)
      if (needsSources)
        this.writeLocalCol(uid, "income_sources", starterSources)
      if (needsBudgets) this.writeLocalCol(uid, "budgets", starterBudgets)
      this.notifyLocalSubscribers(uid)
      return
    }

    const db = getFirebaseRuntime().db!
    const batch = writeBatch(db)
    batch.set(
      doc(db, "users", uid, "settings", "preferences"),
      starterSettings,
      { merge: true },
    )
    for (const acc of starterAccounts) {
      batch.set(doc(db, "users", uid, "accounts", acc.id), acc)
    }
    for (const cat of starterCategories) {
      batch.set(doc(db, "users", uid, "categories", cat.id), cat)
    }
    for (const src of starterSources) {
      batch.set(doc(db, "users", uid, "income_sources", src.id), src)
    }
    for (const bud of starterBudgets) {
      batch.set(doc(db, "users", uid, "budgets", bud.id), bud)
    }
    await batch.commit()
  }

  /**
   * Records Personal Income, Business Gross Revenue, Owner Withdrawals, or Non-Income Inflows.
   * Atomically creates 3 linked GivingAllocation records ONLY when eligible personal income is recorded.
   */
  public async recordIncomeOrInflow(
    uid: string,
    input: RecordIncomeInput,
  ): Promise<{
    transaction: LedgerTransaction
    allocations: GivingAllocation[]
    wasIdempotentReplay: boolean
  }> {
    this.assertAuthorized(uid)

    const amount = Math.round(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Income/inflow amount must be greater than UGX 0.")
    }
    if (!input.idempotencyKey?.trim()) {
      throw new Error("Idempotency key is required for financial integrity.")
    }

    if (input.incomeType === "entrusted_inflow") {
      throw new Error(
        "Use Entrusted Funds movement for custodial money so it stays segregated from personal accounts.",
      )
    }
    if (input.incomeType === "transfer") {
      throw new Error(
        "Use Account Transfer for moving money between accounts so no duplicate income is created.",
      )
    }

    const snap = await this.getSnapshot(uid)

    // 1. Idempotency check
    const existingByIdempotency = snap.transactions.find(
      (t) => t.idempotencyKey === input.idempotencyKey,
    )
    if (existingByIdempotency) {
      const existingAllocs = snap.allocations.filter(
        (a) => a.sourceTransactionId === existingByIdempotency.id,
      )
      return {
        transaction: existingByIdempotency,
        allocations: existingAllocs,
        wasIdempotentReplay: true,
      }
    }

    const account = snap.accounts.find((a) => a.id === input.accountId)
    if (!account) {
      throw new Error("Selected destination account does not exist.")
    }

    const source = snap.incomeSources.find((s) => s.id === input.incomeSourceId)
    const sourceName = source?.name ?? "Direct Income"

    const kind: LedgerTransaction["kind"] =
      input.incomeType === "business_gross_revenue"
        ? "business_revenue"
        : input.incomeType === "owner_withdrawal"
          ? "owner_withdrawal"
          : isEligiblePersonalIncomeType(input.incomeType)
            ? "personal_income"
            : "non_income_inflow"

    // Guard against classifying business account deposits as personal income unintentionally
    if (
      kind === "personal_income" &&
      account.type === "business"
    ) {
      throw new Error(
        "Business accounts receive Business Gross Revenue, not personal income. Record as Business Gross Revenue first, then use Owner Withdrawal when drawing personal pay.",
      )
    }

    const fingerprint = buildTransactionFingerprint({
      kind,
      amount,
      date: input.date,
      accountId: input.accountId,
      title: input.title,
      incomeSourceId: input.incomeSourceId,
    })

    // 2. Duplicate submission protection
    if (!input.allowDuplicateFingerprint) {
      const duplicate = snap.transactions.find(
        (t) => t.status !== "voided" && t.fingerprint === fingerprint,
      )
      if (duplicate) {
        throw new Error(
          `DUPLICATE_DETECTED: An identical ${kind.replace("_", " ")} record ("${duplicate.title}" for UGX ${amount.toLocaleString("en-UG")} on ${input.date}) already exists.`,
        )
      }
    }

    const nowIso = new Date().toISOString()
    const txId = createUniqueId("tx")

    let businessDebitLeg: LedgerTransaction | null = null
    if (
      kind === "owner_withdrawal" &&
      input.sourceBusinessAccountId &&
      input.sourceBusinessAccountId !== input.accountId
    ) {
      const bizAccount = snap.accounts.find(
        (a) => a.id === input.sourceBusinessAccountId,
      )
      if (!bizAccount) {
        throw new Error("Selected source business account does not exist.")
      }
      const debitId = createUniqueId("tx_biz_out")
      businessDebitLeg = {
        id: debitId,
        ownerUid: uid,
        idempotencyKey: `${input.idempotencyKey}:biz_out`,
        fingerprint: `${fingerprint}:biz_out`,
        kind: "owner_withdrawal_out",
        direction: "out",
        status: "active",
        amount,
        date: input.date,
        monthKey: toMonthKey(input.date),
        title: `Owner Withdrawal → ${account.name}`,
        description: input.description || input.title,
        accountId: bizAccount.id,
        accountName: bizAccount.name,
        incomeSourceId: input.incomeSourceId || null,
        incomeSourceName: sourceName,
        counterpartyAccountId: account.id,
        counterpartyAccountName: account.name,
        linkedTransactionId: txId,
        auditTrail: [
          {
            timestamp: nowIso,
            action: "created",
            actorUid: uid,
            reason: "Atomic business debit leg for owner withdrawal",
            newAmount: amount,
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      }
    }

    const eligible = isEligiblePersonalIncomeType(input.incomeType)

    const tx: LedgerTransaction = {
      id: txId,
      ownerUid: uid,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      kind,
      direction: "in",
      status: "active",
      amount,
      date: input.date,
      monthKey: toMonthKey(input.date),
      title: input.title.trim(),
      description: input.description.trim(),
      accountId: account.id,
      accountName: account.name,
      incomeSourceId: input.incomeSourceId || null,
      incomeSourceName: sourceName,
      incomeType: input.incomeType,
      counterpartyAccountId: businessDebitLeg?.accountId ?? null,
      counterpartyAccountName: businessDebitLeg?.accountName ?? null,
      linkedTransactionId: businessDebitLeg?.id ?? null,
      allocationsGenerated: eligible,
      projectId: input.projectId ?? null,
      auditTrail: [
        {
          timestamp: nowIso,
          action: "created",
          actorUid: uid,
          reason: "Initial record created",
          newAmount: amount,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const allocations = eligible
      ? buildGivingAllocationsForIncome(tx, snap.settings, nowIso)
      : []

    if (!this.isCloudMode()) {
      // Atomic Local Vault commit
      const currentTxs = this.readLocalCol<LedgerTransaction>(
        uid,
        "transactions",
      )
      const currentAllocs = this.readLocalCol<GivingAllocation>(
        uid,
        "allocations",
      )

      // Prevent duplicate allocations via deterministic ID verification
      const allocMap = new Map(currentAllocs.map((a) => [a.id, a]))
      for (const alloc of allocations) {
        if (!allocMap.has(alloc.id)) {
          allocMap.set(alloc.id, alloc)
        }
      }

      const nextTxs = businessDebitLeg
        ? [tx, businessDebitLeg, ...currentTxs]
        : [tx, ...currentTxs]

      this.writeLocalCol(uid, "transactions", nextTxs)
      this.writeLocalCol(uid, "allocations", Array.from(allocMap.values()))
      this.notifyLocalSubscribers(uid)

      return { transaction: tx, allocations, wasIdempotentReplay: false }
    }

    // Atomic Cloud Firestore Transaction
    const db = getFirebaseRuntime().db!
    await runTransaction(db, async (fsTx) => {
      const txRef = doc(db, "users", uid, "transactions", tx.id)
      fsTx.set(txRef, tx)
      if (businessDebitLeg) {
        const bizRef = doc(
          db,
          "users",
          uid,
          "transactions",
          businessDebitLeg.id,
        )
        fsTx.set(bizRef, businessDebitLeg)
      }
      for (const alloc of allocations) {
        const allocRef = doc(db, "users", uid, "allocations", alloc.id)
        fsTx.set(allocRef, alloc)
      }
    })

    return { transaction: tx, allocations, wasIdempotentReplay: false }
  }

  /**
   * Records Personal Expense or Business/Project Cost.
   */
  public async recordExpense(
    uid: string,
    input: RecordExpenseInput,
  ): Promise<LedgerTransaction> {
    this.assertAuthorized(uid)
    const amount = Math.round(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Expense amount must be greater than UGX 0.")
    }

    const snap = await this.getSnapshot(uid)
    const existing = snap.transactions.find(
      (t) => t.idempotencyKey === input.idempotencyKey,
    )
    if (existing) return existing

    const account = snap.accounts.find((a) => a.id === input.accountId)
    if (!account) throw new Error("Selected payment account does not exist.")

    const category = snap.categories.find((c) => c.id === input.categoryId)
    const kind: LedgerTransaction["kind"] =
      input.isProjectCost || category?.kind === "business_cost"
        ? "project_cost"
        : "personal_expense"

    const fingerprint = buildTransactionFingerprint({
      kind,
      amount,
      date: input.date,
      accountId: input.accountId,
      title: input.title,
      incomeSourceId: input.incomeSourceId,
    })

    if (!input.allowDuplicateFingerprint) {
      const duplicate = snap.transactions.find(
        (t) => t.status !== "voided" && t.fingerprint === fingerprint,
      )
      if (duplicate) {
        throw new Error(
          `DUPLICATE_DETECTED: An identical expense ("${duplicate.title}" for UGX ${amount.toLocaleString("en-UG")} on ${input.date}) already exists.`,
        )
      }
    }

    const nowIso = new Date().toISOString()
    const source = snap.incomeSources.find((s) => s.id === input.incomeSourceId)

    const tx: LedgerTransaction = {
      id: createUniqueId("tx"),
      ownerUid: uid,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      kind,
      direction: "out",
      status: "active",
      amount,
      date: input.date,
      monthKey: toMonthKey(input.date),
      title: input.title.trim(),
      description: input.description.trim(),
      accountId: account.id,
      accountName: account.name,
      categoryId: category?.id ?? input.categoryId,
      categoryName: category?.name ?? "General Expense",
      incomeSourceId: input.incomeSourceId ?? null,
      incomeSourceName: source?.name ?? null,
      projectId: input.projectId ?? null,
      recurringExpenseId: input.recurringExpenseId ?? null,
      auditTrail: [
        {
          timestamp: nowIso,
          action: "created",
          actorUid: uid,
          reason: "Initial expense recorded",
          newAmount: amount,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    if (!this.isCloudMode()) {
      const currentTxs = this.readLocalCol<LedgerTransaction>(
        uid,
        "transactions",
      )
      this.writeLocalCol(uid, "transactions", [tx, ...currentTxs])

      if (input.recurringExpenseId) {
        const recs = this.readLocalCol<RecurringExpense>(
          uid,
          "recurring_expenses",
        )
        this.writeLocalCol(
          uid,
          "recurring_expenses",
          recs.map((r) =>
            r.id === input.recurringExpenseId
              ? { ...r, lastPaidMonthKey: tx.monthKey, updatedAt: nowIso }
              : r,
          ),
        )
      }
      this.notifyLocalSubscribers(uid)
      return tx
    }

    const db = getFirebaseRuntime().db!
    const batch = writeBatch(db)
    batch.set(doc(db, "users", uid, "transactions", tx.id), tx)
    if (input.recurringExpenseId) {
      batch.set(
        doc(db, "users", uid, "recurring_expenses", input.recurringExpenseId),
        { lastPaidMonthKey: tx.monthKey, updatedAt: nowIso },
        { merge: true },
      )
    }
    await batch.commit()
    return tx
  }

  /**
   * Linked Account Transfer
   * Atomically debits source account and credits destination account.
   * Creates ZERO new income, ZERO expense, and ZERO giving allocations.
   */
  public async recordTransfer(
    uid: string,
    input: RecordTransferInput,
  ): Promise<{ outLeg: LedgerTransaction; inLeg: LedgerTransaction }> {
    this.assertAuthorized(uid)
    const amount = Math.round(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Transfer amount must be greater than UGX 0.")
    }
    if (input.fromAccountId === input.toAccountId) {
      throw new Error("Source and destination accounts must be different.")
    }

    const snap = await this.getSnapshot(uid)
    const existingOut = snap.transactions.find(
      (t) => t.idempotencyKey === `${input.idempotencyKey}:out`,
    )
    const existingIn = snap.transactions.find(
      (t) => t.idempotencyKey === `${input.idempotencyKey}:in`,
    )
    if (existingOut && existingIn) {
      return { outLeg: existingOut, inLeg: existingIn }
    }

    const fromAcc = snap.accounts.find((a) => a.id === input.fromAccountId)
    const toAcc = snap.accounts.find((a) => a.id === input.toAccountId)
    if (!fromAcc || !toAcc) {
      throw new Error("Both transfer accounts must exist.")
    }

    const nowIso = new Date().toISOString()
    const groupId = createUniqueId("trf")
    const outId = `${groupId}_out`
    const inId = `${groupId}_in`

    const outLeg: LedgerTransaction = {
      id: outId,
      ownerUid: uid,
      idempotencyKey: `${input.idempotencyKey}:out`,
      fingerprint: buildTransactionFingerprint({
        kind: "transfer_out",
        amount,
        date: input.date,
        accountId: fromAcc.id,
        counterpartyAccountId: toAcc.id,
        title: `Transfer to ${toAcc.name}`,
      }),
      kind: "transfer",
      direction: "out",
      status: "active",
      amount,
      date: input.date,
      monthKey: toMonthKey(input.date),
      title: `Transfer to ${toAcc.name}`,
      description: input.description.trim() || "Internal account transfer",
      accountId: fromAcc.id,
      accountName: fromAcc.name,
      incomeType: "transfer",
      transferGroupId: groupId,
      counterpartyAccountId: toAcc.id,
      counterpartyAccountName: toAcc.name,
      linkedTransactionId: inId,
      allocationsGenerated: false,
      auditTrail: [
        {
          timestamp: nowIso,
          action: "created",
          actorUid: uid,
          reason: "Atomic linked transfer (outbound leg)",
          newAmount: amount,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const inLeg: LedgerTransaction = {
      id: inId,
      ownerUid: uid,
      idempotencyKey: `${input.idempotencyKey}:in`,
      fingerprint: buildTransactionFingerprint({
        kind: "transfer_in",
        amount,
        date: input.date,
        accountId: toAcc.id,
        counterpartyAccountId: fromAcc.id,
        title: `Transfer from ${fromAcc.name}`,
      }),
      kind: "transfer",
      direction: "in",
      status: "active",
      amount,
      date: input.date,
      monthKey: toMonthKey(input.date),
      title: `Transfer from ${fromAcc.name}`,
      description: input.description.trim() || "Internal account transfer",
      accountId: toAcc.id,
      accountName: toAcc.name,
      incomeType: "transfer",
      transferGroupId: groupId,
      counterpartyAccountId: fromAcc.id,
      counterpartyAccountName: fromAcc.name,
      linkedTransactionId: outId,
      allocationsGenerated: false,
      auditTrail: [
        {
          timestamp: nowIso,
          action: "created",
          actorUid: uid,
          reason: "Atomic linked transfer (inbound leg)",
          newAmount: amount,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    if (!this.isCloudMode()) {
      const currentTxs = this.readLocalCol<LedgerTransaction>(
        uid,
        "transactions",
      )
      this.writeLocalCol(uid, "transactions", [inLeg, outLeg, ...currentTxs])
      this.notifyLocalSubscribers(uid)
      return { outLeg, inLeg }
    }

    const db = getFirebaseRuntime().db!
    await runTransaction(db, async (fsTx) => {
      fsTx.set(doc(db, "users", uid, "transactions", outLeg.id), outLeg)
      fsTx.set(doc(db, "users", uid, "transactions", inLeg.id), inLeg)
    })
    return { outLeg, inLeg }
  }

  /**
   * Pays an outstanding Giving Allocation atomically.
   * Reduces the account balance ONCE and closes the outstanding obligation without double-counting.
   * Strictly rejects paying an already-paid or voided allocation.
   */
  public async payAllocation(
    uid: string,
    input: PayAllocationInput,
  ): Promise<{
    paymentTransaction: LedgerTransaction
    updatedAllocation: GivingAllocation
  }> {
    this.assertAuthorized(uid)
    const snap = await this.getSnapshot(uid)

    // Idempotency replay check
    const existingPayTx = snap.transactions.find(
      (t) => t.idempotencyKey === input.idempotencyKey,
    )
    if (existingPayTx) {
      const alloc = snap.allocations.find((a) => a.id === input.allocationId)
      if (alloc) {
        return {
          paymentTransaction: existingPayTx,
          updatedAllocation: alloc,
        }
      }
    }

    const alloc = snap.allocations.find((a) => a.id === input.allocationId)
    if (!alloc) {
      throw new Error("Giving allocation record not found.")
    }
    if (alloc.status === "paid") {
      throw new Error(
        `ALREADY_PAID: This ${alloc.label} obligation (UGX ${alloc.amount.toLocaleString("en-UG")}) has already been settled and cannot be deducted twice.`,
      )
    }
    if (alloc.status === "voided") {
      throw new Error("Cannot pay a voided allocation.")
    }

    const account = snap.accounts.find((a) => a.id === input.paidFromAccountId)
    if (!account) {
      throw new Error("Selected payment account does not exist.")
    }

    const nowIso = new Date().toISOString()
    const payTxId = `pay_${alloc.id}`

    const paymentTransaction: LedgerTransaction = {
      id: payTxId,
      ownerUid: uid,
      idempotencyKey: input.idempotencyKey,
      fingerprint: buildTransactionFingerprint({
        kind: "allocation_payment",
        amount: alloc.amount,
        date: input.date,
        accountId: account.id,
        linkedAllocationId: alloc.id,
        title: `${alloc.label} Payment (${alloc.sourceTransactionTitle})`,
      }),
      kind: "allocation_payment",
      direction: "out",
      status: "active",
      amount: alloc.amount,
      date: input.date,
      monthKey: toMonthKey(input.date),
      title: `${alloc.label} Payment · ${alloc.sourceTransactionTitle}`,
      description:
        input.notes?.trim() ||
        `Settled ${alloc.percentage}% ${alloc.label} obligation from ${alloc.sourceTransactionTitle}`,
      accountId: account.id,
      accountName: account.name,
      categoryId: "cat_giving",
      categoryName: "Tithe, Thanksgiving & Seed",
      linkedAllocationId: alloc.id,
      auditTrail: [
        {
          timestamp: nowIso,
          action: "created",
          actorUid: uid,
          reason: `Confirmed payment for allocation ${alloc.id}`,
          newAmount: alloc.amount,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    const updatedAllocation: GivingAllocation = {
      ...alloc,
      status: "paid",
      paidAt: input.date,
      paidMonthKey: toMonthKey(input.date),
      paymentTransactionId: payTxId,
      paidFromAccountId: account.id,
      paidFromAccountName: account.name,
      notes: input.notes?.trim() ? input.notes.trim() : alloc.notes,
      updatedAt: nowIso,
    }

    if (!this.isCloudMode()) {
      const currentAllocs = this.readLocalCol<GivingAllocation>(
        uid,
        "allocations",
      )
      const freshTarget = currentAllocs.find((a) => a.id === alloc.id)
      if (!freshTarget || freshTarget.status === "paid") {
        throw new Error(
          "ALREADY_PAID: Allocation was already paid; duplicate deduction prevented.",
        )
      }

      const currentTxs = this.readLocalCol<LedgerTransaction>(
        uid,
        "transactions",
      )
      if (currentTxs.some((t) => t.id === payTxId && t.status !== "voided")) {
        throw new Error(
          "ALREADY_PAID: Payment transaction already exists for this allocation.",
        )
      }

      this.writeLocalCol(uid, "transactions", [
        paymentTransaction,
        ...currentTxs,
      ])
      this.writeLocalCol(
        uid,
        "allocations",
        currentAllocs.map((a) =>
          a.id === alloc.id ? updatedAllocation : a,
        ),
      )
      this.notifyLocalSubscribers(uid)
      return { paymentTransaction, updatedAllocation }
    }

    const db = getFirebaseRuntime().db!
    await runTransaction(db, async (fsTx) => {
      const allocRef = doc(db, "users", uid, "allocations", alloc.id)
      const payRef = doc(db, "users", uid, "transactions", payTxId)
      const liveAllocSnap = await fsTx.get(allocRef)
      if (!liveAllocSnap.exists()) {
        throw new Error("Allocation record not found in Firestore.")
      }
      const liveAlloc = liveAllocSnap.data() as GivingAllocation
      if (liveAlloc.status === "paid") {
        throw new Error(
          "ALREADY_PAID: Allocation was already settled; duplicate payment blocked.",
        )
      }
      fsTx.set(payRef, paymentTransaction)
      fsTx.set(allocRef, updatedAllocation)
    })

    return { paymentTransaction, updatedAllocation }
  }

  /**
   * Records Entrusted Custodial Fund receipt or disbursement.
   * Strictly segregated from personal balances, personal income, and giving allocations.
   */
  public async recordEntrustedMovement(
    uid: string,
    input: RecordEntrustedMovementInput,
  ): Promise<LedgerTransaction> {
    this.assertAuthorized(uid)
    const amount = Math.round(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Entrusted movement amount must be greater than UGX 0.")
    }

    const snap = await this.getSnapshot(uid)
    const existing = snap.transactions.find(
      (t) => t.idempotencyKey === input.idempotencyKey,
    )
    if (existing) return existing

    const fund = snap.entrustedFunds.find(
      (f) => f.id === input.entrustedFundId,
    )
    if (!fund) {
      throw new Error("Selected entrusted fund does not exist.")
    }

    const kind =
      input.direction === "in" ? "entrusted_inflow" : "entrusted_outflow"
    const nowIso = new Date().toISOString()

    const tx: LedgerTransaction = {
      id: createUniqueId("tx_ent"),
      ownerUid: uid,
      idempotencyKey: input.idempotencyKey,
      fingerprint: buildTransactionFingerprint({
        kind,
        amount,
        date: input.date,
        accountId: null,
        title: input.title,
      }),
      kind,
      direction: input.direction,
      status: "active",
      amount,
      date: input.date,
      monthKey: toMonthKey(input.date),
      title: input.title.trim(),
      description: input.description.trim(),
      accountId: null,
      accountName: `Entrusted · ${fund.name}`,
      incomeType: input.direction === "in" ? "entrusted_inflow" : null,
      entrustedFundId: fund.id,
      entrustedFundName: fund.name,
      allocationsGenerated: false,
      auditTrail: [
        {
          timestamp: nowIso,
          action: "created",
          actorUid: uid,
          reason: `Custodial ${input.direction === "in" ? "receipt" : "disbursement"} for ${fund.name}`,
          newAmount: amount,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    if (!this.isCloudMode()) {
      const currentTxs = this.readLocalCol<LedgerTransaction>(
        uid,
        "transactions",
      )
      this.writeLocalCol(uid, "transactions", [tx, ...currentTxs])
      this.notifyLocalSubscribers(uid)
      return tx
    }

    const db = getFirebaseRuntime().db!
    await setDoc(doc(db, "users", uid, "transactions", tx.id), tx)
    return tx
  }

  /**
   * Records Savings Goal Deposit (earmark) or Withdrawal (release).
   */
  public async recordSavingsMovement(
    uid: string,
    input: RecordSavingsMovementInput,
  ): Promise<LedgerTransaction> {
    this.assertAuthorized(uid)
    const amount = Math.round(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Savings movement amount must be greater than UGX 0.")
    }

    const snap = await this.getSnapshot(uid)
    const existing = snap.transactions.find(
      (t) => t.idempotencyKey === input.idempotencyKey,
    )
    if (existing) return existing

    const goal = snap.savingsGoals.find((g) => g.id === input.savingsGoalId)
    if (!goal) throw new Error("Savings goal not found.")

    const kind =
      input.direction === "deposit" ? "savings_deposit" : "savings_withdrawal"
    const nowIso = new Date().toISOString()

    const tx: LedgerTransaction = {
      id: createUniqueId("tx_sav"),
      ownerUid: uid,
      idempotencyKey: input.idempotencyKey,
      fingerprint: buildTransactionFingerprint({
        kind,
        amount,
        date: input.date,
        accountId: input.accountId,
        title: `${goal.name} ${input.direction}`,
      }),
      kind,
      direction: "earmark",
      status: "active",
      amount,
      date: input.date,
      monthKey: toMonthKey(input.date),
      title:
        input.direction === "deposit"
          ? `Earmarked for ${goal.name}`
          : `Released from ${goal.name}`,
      description: input.notes.trim(),
      accountId: input.accountId,
      accountName: `Savings Goal · ${goal.name}`,
      savingsGoalId: goal.id,
      savingsGoalName: goal.name,
      auditTrail: [
        {
          timestamp: nowIso,
          action: "created",
          actorUid: uid,
          reason: `Savings goal ${input.direction}`,
          newAmount: amount,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    if (!this.isCloudMode()) {
      const currentTxs = this.readLocalCol<LedgerTransaction>(
        uid,
        "transactions",
      )
      this.writeLocalCol(uid, "transactions", [tx, ...currentTxs])
      this.notifyLocalSubscribers(uid)
      return tx
    }

    const db = getFirebaseRuntime().db!
    await setDoc(doc(db, "users", uid, "transactions", tx.id), tx)
    return tx
  }

  /**
   * Auditable Transaction Correction
   * Preserves complete auditTrail history and updates linked unpaid allocations if an income record is amended.
   */
  public async correctTransaction(
    uid: string,
    input: CorrectTransactionInput,
  ): Promise<LedgerTransaction> {
    this.assertAuthorized(uid)
    if (!input.reason.trim()) {
      throw new Error("An audit reason is required to correct a transaction.")
    }
    const newAmount = Math.round(input.newAmount)
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      throw new Error("Corrected amount must be greater than UGX 0.")
    }

    const snap = await this.getSnapshot(uid)
    const target = snap.transactions.find((t) => t.id === input.transactionId)
    if (!target) throw new Error("Transaction not found.")
    if (target.status === "voided") {
      throw new Error("Voided transactions cannot be edited.")
    }
    if (target.kind === "allocation_payment") {
      throw new Error(
        "Allocation payment amounts are locked to their obligation record.",
      )
    }

    const linkedAllocs = snap.allocations.filter(
      (a) => a.sourceTransactionId === target.id && a.status !== "voided",
    )
    const hasPaidAlloc = linkedAllocs.some((a) => a.status === "paid")
    if (hasPaidAlloc && newAmount !== target.amount) {
      throw new Error(
        "Cannot alter the amount of an income record whose giving allocations have already been paid. Record a separate adjustment entry instead.",
      )
    }

    const nowIso = new Date().toISOString()
    const updatedTx: LedgerTransaction = {
      ...target,
      amount: newAmount,
      title: input.newTitle.trim() || target.title,
      description: input.newDescription.trim(),
      date: input.newDate || target.date,
      monthKey: toMonthKey(input.newDate || target.date),
      status: "corrected",
      auditTrail: [
        ...target.auditTrail,
        {
          timestamp: nowIso,
          action: "corrected",
          actorUid: uid,
          reason: input.reason.trim(),
          previousAmount: target.amount,
          newAmount,
          previousDescription: target.description,
          newDescription: input.newDescription.trim(),
        },
      ],
      updatedAt: nowIso,
    }

    const updatedAllocs: GivingAllocation[] = linkedAllocs.map((a) => ({
      ...a,
      sourceTransactionTitle: updatedTx.title,
      incomeDate: updatedTx.date,
      monthKey: updatedTx.monthKey,
      baseIncomeAmount: newAmount,
      amount: Math.round((newAmount * a.percentage) / 100),
      updatedAt: nowIso,
    }))

    // Also update linked transfer/business leg if present
    let updatedCounterpartyLeg: LedgerTransaction | null = null
    if (target.linkedTransactionId) {
      const leg = snap.transactions.find(
        (t) => t.id === target.linkedTransactionId,
      )
      if (leg) {
        updatedCounterpartyLeg = {
          ...leg,
          amount: newAmount,
          date: updatedTx.date,
          monthKey: updatedTx.monthKey,
          status: "corrected",
          auditTrail: [
            ...leg.auditTrail,
            {
              timestamp: nowIso,
              action: "corrected",
              actorUid: uid,
              reason: `Linked correction: ${input.reason.trim()}`,
              previousAmount: leg.amount,
              newAmount,
            },
          ],
          updatedAt: nowIso,
        }
      }
    }

    if (!this.isCloudMode()) {
      const currentTxs = this.readLocalCol<LedgerTransaction>(
        uid,
        "transactions",
      )
      this.writeLocalCol(
        uid,
        "transactions",
        currentTxs.map((t) => {
          if (t.id === updatedTx.id) return updatedTx
          if (updatedCounterpartyLeg && t.id === updatedCounterpartyLeg.id)
            return updatedCounterpartyLeg
          return t
        }),
      )
      if (updatedAllocs.length > 0) {
        const allocMap = new Map(updatedAllocs.map((a) => [a.id, a]))
        const currentAllocs = this.readLocalCol<GivingAllocation>(
          uid,
          "allocations",
        )
        this.writeLocalCol(
          uid,
          "allocations",
          currentAllocs.map((a) => allocMap.get(a.id) ?? a),
        )
      }
      this.notifyLocalSubscribers(uid)
      return updatedTx
    }

    const db = getFirebaseRuntime().db!
    const batch = writeBatch(db)
    batch.set(doc(db, "users", uid, "transactions", updatedTx.id), updatedTx)
    if (updatedCounterpartyLeg) {
      batch.set(
        doc(db, "users", uid, "transactions", updatedCounterpartyLeg.id),
        updatedCounterpartyLeg,
      )
    }
    for (const a of updatedAllocs) {
      batch.set(doc(db, "users", uid, "allocations", a.id), a)
    }
    await batch.commit()
    return updatedTx
  }

  /**
   * Auditable Void Operation (never deletes history; marks voided with reason and voids unpaid allocations)
   */
  public async voidTransaction(
    uid: string,
    input: VoidTransactionInput,
  ): Promise<void> {
    this.assertAuthorized(uid)
    if (!input.reason.trim()) {
      throw new Error("An audit reason is required to void a transaction.")
    }

    const snap = await this.getSnapshot(uid)
    const target = snap.transactions.find((t) => t.id === input.transactionId)
    if (!target) throw new Error("Transaction not found.")
    if (target.status === "voided") return

    const linkedAllocs = snap.allocations.filter(
      (a) => a.sourceTransactionId === target.id && a.status !== "voided",
    )
    if (linkedAllocs.some((a) => a.status === "paid")) {
      throw new Error(
        "Cannot void an income transaction after its giving allocations have been paid.",
      )
    }

    const nowIso = new Date().toISOString()
    const voidedTx: LedgerTransaction = {
      ...target,
      status: "voided",
      auditTrail: [
        ...target.auditTrail,
        {
          timestamp: nowIso,
          action: "voided",
          actorUid: uid,
          reason: input.reason.trim(),
          previousAmount: target.amount,
          newAmount: 0,
        },
      ],
      updatedAt: nowIso,
    }

    const linkedLeg = target.linkedTransactionId
      ? snap.transactions.find((t) => t.id === target.linkedTransactionId)
      : null
    const voidedLeg: LedgerTransaction | null = linkedLeg
      ? {
          ...linkedLeg,
          status: "voided",
          auditTrail: [
            ...linkedLeg.auditTrail,
            {
              timestamp: nowIso,
              action: "voided",
              actorUid: uid,
              reason: `Linked void: ${input.reason.trim()}`,
              previousAmount: linkedLeg.amount,
              newAmount: 0,
            },
          ],
          updatedAt: nowIso,
        }
      : null

    // If voiding an allocation_payment, reopen its linked allocation back to unpaid
    let reopenedAlloc: GivingAllocation | null = null
    if (target.kind === "allocation_payment" && target.linkedAllocationId) {
      const paidAlloc = snap.allocations.find(
        (a) => a.id === target.linkedAllocationId,
      )
      if (paidAlloc) {
        reopenedAlloc = {
          ...paidAlloc,
          status: "unpaid",
          paidAt: null,
          paidMonthKey: null,
          paymentTransactionId: null,
          paidFromAccountId: null,
          paidFromAccountName: null,
          updatedAt: nowIso,
        }
      }
    }

    if (!this.isCloudMode()) {
      const currentTxs = this.readLocalCol<LedgerTransaction>(
        uid,
        "transactions",
      )
      this.writeLocalCol(
        uid,
        "transactions",
        currentTxs.map((t) => {
          if (t.id === voidedTx.id) return voidedTx
          if (voidedLeg && t.id === voidedLeg.id) return voidedLeg
          return t
        }),
      )

      const currentAllocs = this.readLocalCol<GivingAllocation>(
        uid,
        "allocations",
      )
      this.writeLocalCol(
        uid,
        "allocations",
        currentAllocs.map((a) => {
          if (reopenedAlloc && a.id === reopenedAlloc.id) return reopenedAlloc
          if (linkedAllocs.some((la) => la.id === a.id)) {
            return { ...a, status: "voided", updatedAt: nowIso }
          }
          return a
        }),
      )
      this.notifyLocalSubscribers(uid)
      return
    }

    const db = getFirebaseRuntime().db!
    const batch = writeBatch(db)
    batch.set(doc(db, "users", uid, "transactions", voidedTx.id), voidedTx)
    if (voidedLeg) {
      batch.set(doc(db, "users", uid, "transactions", voidedLeg.id), voidedLeg)
    }
    if (reopenedAlloc) {
      batch.set(
        doc(db, "users", uid, "allocations", reopenedAlloc.id),
        reopenedAlloc,
      )
    }
    for (const a of linkedAllocs) {
      batch.set(doc(db, "users", uid, "allocations", a.id), {
        ...a,
        status: "voided",
        updatedAt: nowIso,
      })
    }
    await batch.commit()
  }

  /**
   * Generic entity upsert under `users/{uid}/{collection}/{docId}` for accounts, sources,
   * categories, budgets, entrusted_funds, savings_goals, recurring_expenses, tasks, projects,
   * calendar_events, financial_reports, and settings.
   */
  public async saveEntity<T extends { id: string; ownerUid: string }>(
    uid: string,
    collectionName: Exclude<
      UserCollectionName,
      "transactions" | "allocations"
    >,
    entity: T,
  ): Promise<T> {
    this.assertAuthorized(uid)
    if (entity.ownerUid !== uid) {
      throw new Error("PERMISSION_DENIED: Entity ownerUid mismatch.")
    }

    if (!this.isCloudMode()) {
      const existing = this.readLocalCol<T>(uid, collectionName)
      const idx = existing.findIndex((item) => item.id === entity.id)
      const next =
        idx >= 0
          ? existing.map((item, i) => (i === idx ? entity : item))
          : [entity, ...existing]
      this.writeLocalCol(uid, collectionName, next)
      this.notifyLocalSubscribers(uid)
      return entity
    }

    const db = getFirebaseRuntime().db!
    await setDoc(doc(db, "users", uid, collectionName, entity.id), entity)
    return entity
  }

  public async deleteEntity(
    uid: string,
    collectionName: Exclude<
      UserCollectionName,
      "transactions" | "allocations" | "settings"
    >,
    entityId: string,
  ): Promise<void> {
    this.assertAuthorized(uid)
    if (!this.isCloudMode()) {
      const existing = this.readLocalCol<{ id: string }>(uid, collectionName)
      this.writeLocalCol(
        uid,
        collectionName,
        existing.filter((x) => x.id !== entityId),
      )
      this.notifyLocalSubscribers(uid)
      return
    }

    const db = getFirebaseRuntime().db!
    await deleteDoc(doc(db, "users", uid, collectionName, entityId))
  }

  public async updateSettings(
    uid: string,
    partial: Partial<
      Pick<
        UserSettings,
        | "displayName"
        | "currency"
        | "tithePercent"
        | "thanksgivingPercent"
        | "seedPercent"
      >
    >,
  ): Promise<UserSettings> {
    this.assertAuthorized(uid)
    const snap = await this.getSnapshot(uid)
    const tithe =
      partial.tithePercent !== undefined
        ? Math.max(0, Math.min(100, Number(partial.tithePercent)))
        : snap.settings.tithePercent
    const thanksgiving =
      partial.thanksgivingPercent !== undefined
        ? Math.max(0, Math.min(100, Number(partial.thanksgivingPercent)))
        : snap.settings.thanksgivingPercent
    const seed =
      partial.seedPercent !== undefined
        ? Math.max(0, Math.min(100, Number(partial.seedPercent)))
        : snap.settings.seedPercent

    if (tithe + thanksgiving + seed > 100) {
      throw new Error("Total giving allocation percentages cannot exceed 100%.")
    }

    const updated: UserSettings = {
      ...snap.settings,
      id: "preferences",
      ownerUid: uid,
      displayName: partial.displayName?.trim() || snap.settings.displayName,
      currency: partial.currency?.trim() || snap.settings.currency,
      tithePercent: tithe,
      thanksgivingPercent: thanksgiving,
      seedPercent: seed,
      updatedAt: new Date().toISOString(),
    }

    await this.saveEntity(uid, "settings", updated)
    return updated
  }
}

export const defaultRepository = new PhenaxisRepository()

