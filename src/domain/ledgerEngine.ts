import {
  AllocationType,
  DerivedBalances,
  ELIGIBLE_INCOME_TYPES,
  EligibleIncomeType,
  GivingAllocation,
  IncomeClassification,
  LedgerTransaction,
  UserFinancialSnapshot,
  UserSettings,
} from "./types"

const ELIGIBLE_SET = new Set<string>(ELIGIBLE_INCOME_TYPES.map((t) => t.value))

export function isEligiblePersonalIncomeType(
  incomeType: IncomeClassification | string | null | undefined,
): incomeType is EligibleIncomeType {
  if (!incomeType) return false
  return ELIGIBLE_SET.has(incomeType)
}

export function toMonthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function buildTransactionFingerprint(params: {
  kind: string
  amount: number
  date: string
  accountId: string | null
  title: string
  incomeSourceId?: string | null
  counterpartyAccountId?: string | null
  linkedAllocationId?: string | null
}): string {
  const normalizedTitle = params.title.trim().toLowerCase().replace(/\s+/g, " ")
  return [
    params.kind,
    Math.round(params.amount),
    params.date,
    params.accountId ?? "none",
    params.incomeSourceId ?? "none",
    params.counterpartyAccountId ?? "none",
    params.linkedAllocationId ?? "none",
    normalizedTitle,
  ].join("|")
}

export function deterministicAllocationId(
  sourceTransactionId: string,
  allocationType: AllocationType,
): string {
  return `alloc_${sourceTransactionId}_${allocationType}`
}

/**
 * Automatic Giving Allocation Engine
 * Generates 3 separate allocation records (Tithe, Thanksgiving, Seed) linked to an eligible personal income transaction.
 * Strictly excludes entrusted funds, loans, transfers, reimbursements, refunds, opening balances, and business gross revenue.
 */
export function buildGivingAllocationsForIncome(
  tx: LedgerTransaction,
  settings: Pick<
    UserSettings,
    "tithePercent" | "thanksgivingPercent" | "seedPercent"
  >,
  nowIso: string = new Date().toISOString(),
): GivingAllocation[] {
  if (tx.status === "voided") return []
  if (tx.kind !== "personal_income" && tx.kind !== "owner_withdrawal") {
    return []
  }
  if (!isEligiblePersonalIncomeType(tx.incomeType)) {
    return []
  }
  if (tx.amount <= 0) {
    return []
  }

  const specs: {
    type: AllocationType
    label: string
    percentage: number
  }[] = [
    {
      type: "tithe",
      label: "Tithe",
      percentage: Math.max(0, settings.tithePercent),
    },
    {
      type: "thanksgiving",
      label: "Thanksgiving",
      percentage: Math.max(0, settings.thanksgivingPercent),
    },
    {
      type: "seed",
      label: "Seed",
      percentage: Math.max(0, settings.seedPercent),
    },
  ]

  return specs.map((spec) => {
    const amount = Math.round((tx.amount * spec.percentage) / 100)
    return {
      id: deterministicAllocationId(tx.id, spec.type),
      ownerUid: tx.ownerUid,
      sourceTransactionId: tx.id,
      sourceTransactionTitle: tx.title,
      incomeSourceId: tx.incomeSourceId ?? "unspecified",
      incomeSourceName: tx.incomeSourceName ?? "Direct Income",
      incomeType: tx.incomeType as EligibleIncomeType,
      incomeDate: tx.date,
      monthKey: tx.monthKey || toMonthKey(tx.date),
      allocationType: spec.type,
      label: spec.label,
      percentage: spec.percentage,
      baseIncomeAmount: tx.amount,
      amount,
      status: amount === 0 ? "paid" : "unpaid",
      paidAt: amount === 0 ? nowIso.slice(0, 10) : null,
      paidMonthKey: amount === 0 ? toMonthKey(nowIso) : null,
      paymentTransactionId: null,
      paidFromAccountId: null,
      paidFromAccountName: null,
      notes: `Auto-reserved ${spec.percentage}% ${spec.label} on ${tx.title}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
  })
}

/**
 * Derives all 5 required balances purely from transaction and allocation records.
 * Zero reliance on manually editable balance figures.
 */
export function deriveBalances(snapshot: UserFinancialSnapshot): DerivedBalances {
  const accountBalances: Record<string, number> = {}
  const accountTypeMap = new Map<string, string>()

  for (const acc of snapshot.accounts) {
    accountBalances[acc.id] = 0
    accountTypeMap.set(acc.id, acc.type)
  }

  const savingsGoalBalances: Record<string, number> = {}
  for (const goal of snapshot.savingsGoals) {
    savingsGoalBalances[goal.id] = 0
  }

  const entrustedFundSummaries: Record<
    string,
    { received: number; spent: number; remaining: number }
  > = {}
  for (const fund of snapshot.entrustedFunds) {
    entrustedFundSummaries[fund.id] = { received: 0, spent: 0, remaining: 0 }
  }

  for (const tx of snapshot.transactions) {
    if (tx.status === "voided") continue

    // 1. Segregated Entrusted Funds never touch personal/business account balances
    if (tx.kind === "entrusted_inflow" || tx.kind === "entrusted_outflow") {
      const fundId = tx.entrustedFundId ?? "unassigned_fund"
      if (!entrustedFundSummaries[fundId]) {
        entrustedFundSummaries[fundId] = { received: 0, spent: 0, remaining: 0 }
      }
      if (tx.kind === "entrusted_inflow") {
        entrustedFundSummaries[fundId].received += tx.amount
      } else {
        entrustedFundSummaries[fundId].spent += tx.amount
      }
      entrustedFundSummaries[fundId].remaining =
        entrustedFundSummaries[fundId].received -
        entrustedFundSummaries[fundId].spent
      continue
    }

    // 2. Savings Goal Earmarks update designated savings balances without fabricating external outflows
    if (tx.kind === "savings_deposit" || tx.kind === "savings_withdrawal") {
      const goalId = tx.savingsGoalId ?? "unassigned_goal"
      if (savingsGoalBalances[goalId] === undefined) {
        savingsGoalBalances[goalId] = 0
      }
      if (tx.kind === "savings_deposit") {
        savingsGoalBalances[goalId] += tx.amount
      } else {
        savingsGoalBalances[goalId] = Math.max(
          0,
          savingsGoalBalances[goalId] - tx.amount,
        )
      }
      continue
    }

    // 3. Physical Account Cash Movements (Personal & Business accounts)
    if (tx.accountId) {
      if (accountBalances[tx.accountId] === undefined) {
        accountBalances[tx.accountId] = 0
      }
      if (tx.direction === "in") {
        accountBalances[tx.accountId] += tx.amount
      } else if (tx.direction === "out") {
        accountBalances[tx.accountId] -= tx.amount
      }
    }
  }

  let actualAccountBalance = 0
  let businessRetainedBalance = 0

  for (const [accId, bal] of Object.entries(accountBalances)) {
    const accType = accountTypeMap.get(accId)
    if (accType === "business") {
      businessRetainedBalance += bal
    } else {
      actualAccountBalance += bal
    }
  }

  // Unpaid giving allocations constitute Reserved Obligations
  let reservedObligations = 0
  for (const alloc of snapshot.allocations) {
    if (alloc.status === "unpaid") {
      reservedObligations += alloc.amount
    }
  }

  let savingsBalances = 0
  for (const bal of Object.values(savingsGoalBalances)) {
    savingsBalances += bal
  }

  let entrustedBalances = 0
  for (const summary of Object.values(entrustedFundSummaries)) {
    entrustedBalances += summary.remaining
  }

  // Unallocated Available Money = Actual Personal Account Balance - Reserved Obligations - Savings Balances
  const unallocatedAvailableMoney =
    actualAccountBalance - reservedObligations - savingsBalances

  return {
    actualAccountBalance,
    reservedObligations,
    unallocatedAvailableMoney,
    savingsBalances,
    entrustedBalances,
    businessRetainedBalance,
    accountBalances,
    savingsGoalBalances,
    entrustedFundSummaries,
  }
}

export interface IncomeSourceReportRow {
  sourceId: string
  sourceName: string
  defaultType: string
  isBusinessSource: boolean
  transactionCount: number
  eligiblePersonalIncome: number
  businessGrossRevenue: number
  projectCosts: number
  netBusinessEarnings: number
  ownerWithdrawals: number
  retainedBusinessEarnings: number
  givingAllocated: number
}

export function buildIncomeSourceReports(
  snapshot: UserFinancialSnapshot,
  monthKey?: string,
): IncomeSourceReportRow[] {
  const rows = new Map<string, IncomeSourceReportRow>()

  for (const src of snapshot.incomeSources) {
    rows.set(src.id, {
      sourceId: src.id,
      sourceName: src.name,
      defaultType: src.defaultIncomeType,
      isBusinessSource: src.isBusinessSource,
      transactionCount: 0,
      eligiblePersonalIncome: 0,
      businessGrossRevenue: 0,
      projectCosts: 0,
      netBusinessEarnings: 0,
      ownerWithdrawals: 0,
      retainedBusinessEarnings: 0,
      givingAllocated: 0,
    })
  }

  const ensureRow = (id: string, name: string, type: string, isBiz: boolean) => {
    if (!rows.has(id)) {
      rows.set(id, {
        sourceId: id,
        sourceName: name,
        defaultType: type,
        isBusinessSource: isBiz,
        transactionCount: 0,
        eligiblePersonalIncome: 0,
        businessGrossRevenue: 0,
        projectCosts: 0,
        netBusinessEarnings: 0,
        ownerWithdrawals: 0,
        retainedBusinessEarnings: 0,
        givingAllocated: 0,
      })
    }
    return rows.get(id)!
  }

  for (const tx of snapshot.transactions) {
    if (tx.status === "voided") continue
    if (monthKey && tx.monthKey !== monthKey) continue

    if (
      tx.kind === "personal_income" ||
      tx.kind === "owner_withdrawal" ||
      tx.kind === "business_revenue" ||
      tx.kind === "project_cost"
    ) {
      const id = tx.incomeSourceId || "direct_unassigned"
      const name = tx.incomeSourceName || "Direct / General Source"
      const row = ensureRow(
        id,
        name,
        tx.incomeType || "other_income",
        tx.kind === "business_revenue",
      )

      if (tx.kind === "personal_income") {
        row.transactionCount += 1
        row.eligiblePersonalIncome += tx.amount
      } else if (tx.kind === "owner_withdrawal") {
        row.transactionCount += 1
        row.ownerWithdrawals += tx.amount
        row.eligiblePersonalIncome += tx.amount
      } else if (tx.kind === "business_revenue") {
        row.transactionCount += 1
        row.businessGrossRevenue += tx.amount
      } else if (tx.kind === "project_cost") {
        row.projectCosts += tx.amount
      }
    }
  }

  for (const alloc of snapshot.allocations) {
    if (alloc.status === "voided") continue
    if (monthKey && alloc.monthKey !== monthKey) continue
    const id = alloc.incomeSourceId || "direct_unassigned"
    const row = rows.get(id)
    if (row) {
      row.givingAllocated += alloc.amount
    }
  }

  const result = Array.from(rows.values()).map((r) => {
    const netBiz = r.businessGrossRevenue - r.projectCosts
    const retained = netBiz - r.ownerWithdrawals
    return {
      ...r,
      netBusinessEarnings: netBiz,
      retainedBusinessEarnings: retained,
    }
  })

  return result.sort(
    (a, b) =>
      b.eligiblePersonalIncome +
      b.businessGrossRevenue -
      (a.eligiblePersonalIncome + a.businessGrossRevenue),
  )
}

export interface MonthlyIncomeSummary {
  monthKey: string
  byStream: Record<EligibleIncomeType, number>
  totalEligiblePersonalIncome: number
  businessGrossRevenue: number
  projectCosts: number
  netBusinessEarnings: number
  ownerWithdrawals: number
  excludedNonIncomeInflows: {
    loans: number
    reimbursements: number
    refunds: number
    openingBalances: number
    transfersIn: number
    entrustedInflows: number
    total: number
  }
}

export function buildMonthlyIncomeSummary(
  snapshot: UserFinancialSnapshot,
  monthKey: string,
): MonthlyIncomeSummary {
  const byStream: Record<EligibleIncomeType, number> = {
    employment_salary: 0,
    part_time_job: 0,
    freelance_earnings: 0,
    client_projects: 0,
    creative_technical_services: 0,
    ministry_allowances: 0,
    owner_withdrawal: 0,
    personal_gift: 0,
    other_income: 0,
  }

  let totalEligiblePersonalIncome = 0
  let businessGrossRevenue = 0
  let projectCosts = 0
  let ownerWithdrawals = 0

  const excluded = {
    loans: 0,
    reimbursements: 0,
    refunds: 0,
    openingBalances: 0,
    transfersIn: 0,
    entrustedInflows: 0,
    total: 0,
  }

  for (const tx of snapshot.transactions) {
    if (tx.status === "voided") continue
    if (tx.monthKey !== monthKey) continue

    if (tx.kind === "personal_income" || tx.kind === "owner_withdrawal") {
      const stream = isEligiblePersonalIncomeType(tx.incomeType)
        ? tx.incomeType
        : "other_income"
      byStream[stream] += tx.amount
      totalEligiblePersonalIncome += tx.amount
      if (tx.kind === "owner_withdrawal" || stream === "owner_withdrawal") {
        ownerWithdrawals += tx.amount
      }
    } else if (tx.kind === "business_revenue") {
      businessGrossRevenue += tx.amount
    } else if (tx.kind === "project_cost") {
      projectCosts += tx.amount
    } else if (tx.kind === "non_income_inflow") {
      if (tx.incomeType === "loan_proceeds") excluded.loans += tx.amount
      else if (tx.incomeType === "reimbursement")
        excluded.reimbursements += tx.amount
      else if (tx.incomeType === "refund") excluded.refunds += tx.amount
      else if (tx.incomeType === "opening_balance")
        excluded.openingBalances += tx.amount
    } else if (tx.kind === "transfer" && tx.direction === "in") {
      excluded.transfersIn += tx.amount
    } else if (tx.kind === "entrusted_inflow") {
      excluded.entrustedInflows += tx.amount
    }
  }

  excluded.total =
    excluded.loans +
    excluded.reimbursements +
    excluded.refunds +
    excluded.openingBalances +
    excluded.transfersIn +
    excluded.entrustedInflows

  return {
    monthKey,
    byStream,
    totalEligiblePersonalIncome,
    businessGrossRevenue,
    projectCosts,
    netBusinessEarnings: businessGrossRevenue - projectCosts,
    ownerWithdrawals,
    excludedNonIncomeInflows: excluded,
  }
}

export interface MonthlyGivingSummary {
  monthKey: string
  byType: Record<
    AllocationType,
    {
      allocated: number
      paidForMonthIncome: number
      unpaidForMonthIncome: number
      cashPaidInMonth: number
    }
  >
  totalAllocated: number
  totalPaidForMonthIncome: number
  totalUnpaidForMonthIncome: number
  totalCashPaidInMonth: number
  allTimeUnpaidObligations: number
}

export function buildMonthlyGivingSummary(
  snapshot: UserFinancialSnapshot,
  monthKey: string,
): MonthlyGivingSummary {
  const byType: MonthlyGivingSummary["byType"] = {
    tithe: {
      allocated: 0,
      paidForMonthIncome: 0,
      unpaidForMonthIncome: 0,
      cashPaidInMonth: 0,
    },
    thanksgiving: {
      allocated: 0,
      paidForMonthIncome: 0,
      unpaidForMonthIncome: 0,
      cashPaidInMonth: 0,
    },
    seed: {
      allocated: 0,
      paidForMonthIncome: 0,
      unpaidForMonthIncome: 0,
      cashPaidInMonth: 0,
    },
  }

  let allTimeUnpaidObligations = 0

  for (const alloc of snapshot.allocations) {
    if (alloc.status === "voided") continue

    if (alloc.status === "unpaid") {
      allTimeUnpaidObligations += alloc.amount
    }

    if (alloc.monthKey === monthKey) {
      byType[alloc.allocationType].allocated += alloc.amount
      if (alloc.status === "paid") {
        byType[alloc.allocationType].paidForMonthIncome += alloc.amount
      } else if (alloc.status === "unpaid") {
        byType[alloc.allocationType].unpaidForMonthIncome += alloc.amount
      }
    }

    if (alloc.status === "paid" && alloc.paidMonthKey === monthKey) {
      byType[alloc.allocationType].cashPaidInMonth += alloc.amount
    }
  }

  const totalAllocated =
    byType.tithe.allocated +
    byType.thanksgiving.allocated +
    byType.seed.allocated
  const totalPaidForMonthIncome =
    byType.tithe.paidForMonthIncome +
    byType.thanksgiving.paidForMonthIncome +
    byType.seed.paidForMonthIncome
  const totalUnpaidForMonthIncome =
    byType.tithe.unpaidForMonthIncome +
    byType.thanksgiving.unpaidForMonthIncome +
    byType.seed.unpaidForMonthIncome
  const totalCashPaidInMonth =
    byType.tithe.cashPaidInMonth +
    byType.thanksgiving.cashPaidInMonth +
    byType.seed.cashPaidInMonth

  return {
    monthKey,
    byType,
    totalAllocated,
    totalPaidForMonthIncome,
    totalUnpaidForMonthIncome,
    totalCashPaidInMonth,
    allTimeUnpaidObligations,
  }
}

export interface MonthlyReconciliationReport {
  monthKey: string
  openingPersonalBalance: number
  eligiblePersonalIncome: number
  nonIncomePersonalInflows: number
  personalLivingExpenses: number
  givingPaymentsOutflow: number
  personalProjectCosts: number
  personalTransfersIn: number
  personalTransfersOut: number
  netPersonalMovement: number
  expectedClosingPersonalBalance: number
  actualClosingPersonalBalance: number
  variance: number
  isReconciled: boolean
  duplicateAllocationErrors: number
  orphanedPaidAllocationErrors: number
}

/**
 * Reconciles monthly reports strictly against transaction & allocation records.
 * Verifies opening + inflows - outflows === closing balance with zero variance,
 * zero duplicate allocations, and 1-to-1 payment transaction linkage.
 */
export function reconcileMonth(
  snapshot: UserFinancialSnapshot,
  monthKey: string,
): MonthlyReconciliationReport {
  const businessAccountIds = new Set(
    snapshot.accounts.filter((a) => a.type === "business").map((a) => a.id),
  )

  const isPersonalAccount = (accountId: string | null | undefined) =>
    Boolean(accountId && !businessAccountIds.has(accountId))

  let openingPersonalBalance = 0
  let eligiblePersonalIncome = 0
  let nonIncomePersonalInflows = 0
  let personalLivingExpenses = 0
  let givingPaymentsOutflow = 0
  let personalProjectCosts = 0
  let personalTransfersIn = 0
  let personalTransfersOut = 0
  let actualClosingPersonalBalance = 0

  const activePaymentTxMap = new Map<string, LedgerTransaction>()

  for (const tx of snapshot.transactions) {
    if (tx.status === "voided") continue

    if (tx.kind === "allocation_payment") {
      activePaymentTxMap.set(tx.id, tx)
    }

    if (
      tx.kind === "entrusted_inflow" ||
      tx.kind === "entrusted_outflow" ||
      tx.kind === "savings_deposit" ||
      tx.kind === "savings_withdrawal"
    ) {
      continue
    }

    if (!isPersonalAccount(tx.accountId)) continue

    const signed = tx.direction === "in" ? tx.amount : -tx.amount

    if (tx.monthKey < monthKey) {
      openingPersonalBalance += signed
      actualClosingPersonalBalance += signed
    } else if (tx.monthKey === monthKey) {
      actualClosingPersonalBalance += signed

      if (tx.kind === "personal_income" || tx.kind === "owner_withdrawal") {
        eligiblePersonalIncome += tx.amount
      } else if (tx.kind === "non_income_inflow") {
        nonIncomePersonalInflows += tx.amount
      } else if (tx.kind === "personal_expense") {
        personalLivingExpenses += tx.amount
      } else if (tx.kind === "allocation_payment") {
        givingPaymentsOutflow += tx.amount
      } else if (tx.kind === "project_cost") {
        personalProjectCosts += tx.amount
      } else if (tx.kind === "transfer") {
        if (tx.direction === "in") personalTransfersIn += tx.amount
        else personalTransfersOut += tx.amount
      } else if (tx.kind === "business_revenue") {
        // If user explicitly placed business revenue into a personal account, track as non-personal-income inflow
        nonIncomePersonalInflows += tx.amount
      }
    }
  }

  const netPersonalMovement =
    eligiblePersonalIncome +
    nonIncomePersonalInflows +
    personalTransfersIn -
    personalLivingExpenses -
    givingPaymentsOutflow -
    personalProjectCosts -
    personalTransfersOut

  const expectedClosingPersonalBalance =
    openingPersonalBalance + netPersonalMovement
  const variance = actualClosingPersonalBalance - expectedClosingPersonalBalance

  // Integrity check 1: No duplicate allocations per (sourceTransactionId, allocationType)
  const seenAllocKeys = new Set<string>()
  let duplicateAllocationErrors = 0
  let orphanedPaidAllocationErrors = 0

  for (const alloc of snapshot.allocations) {
    if (alloc.status === "voided") continue
    const key = `${alloc.sourceTransactionId}:${alloc.allocationType}`
    if (seenAllocKeys.has(key)) {
      duplicateAllocationErrors += 1
    }
    seenAllocKeys.add(key)

    if (alloc.status === "paid" && alloc.amount > 0) {
      if (!alloc.paymentTransactionId) {
        orphanedPaidAllocationErrors += 1
      } else {
        const payTx = activePaymentTxMap.get(alloc.paymentTransactionId)
        if (!payTx || payTx.amount !== alloc.amount) {
          orphanedPaidAllocationErrors += 1
        }
      }
    }
  }

  return {
    monthKey,
    openingPersonalBalance,
    eligiblePersonalIncome,
    nonIncomePersonalInflows,
    personalLivingExpenses,
    givingPaymentsOutflow,
    personalProjectCosts,
    personalTransfersIn,
    personalTransfersOut,
    netPersonalMovement,
    expectedClosingPersonalBalance,
    actualClosingPersonalBalance,
    variance,
    isReconciled:
      variance === 0 &&
      duplicateAllocationErrors === 0 &&
      orphanedPaidAllocationErrors === 0,
    duplicateAllocationErrors,
    orphanedPaidAllocationErrors,
  }
}

