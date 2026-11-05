import {
  buildIncomeSourceReports,
  buildMonthlyGivingSummary,
  buildMonthlyIncomeSummary,
  deriveBalances,
  reconcileMonth,
  toMonthKey,
} from "./ledgerEngine"
import { UserFinancialSnapshot } from "./types"

export interface AIInsightItem {
  id: string
  severity: "positive" | "opportunity" | "warning" | "critical"
  category:
    | "balances"
    | "giving"
    | "income"
    | "recurring"
    | "savings"
    | "business"
    | "entrusted"
  title: string
  detail: string
  recommendation: string
  metricLabel: string
  metricValue: string
}

export interface AIAccountantAnalysis {
  generatedAt: string
  monthKey: string
  healthScore: number
  headline: string
  executiveSummary: string
  keyMetrics: {
    actualPersonalBalance: number
    reservedObligations: number
    savingsBalances: number
    unallocatedAvailable: number
    entrustedBalances: number
    businessRetainedBalance: number
    monthlyEligibleIncome: number
    monthlyPersonalExpenses: number
    unpaidRecurringCommitments: number
    freeAfterCommitments: number
  }
  insights: AIInsightItem[]
}

const fmtUgx = (amount: number) =>
  `UGX ${Math.round(amount).toLocaleString("en-UG")}`

/**
 * PHENAXIS Financial Intelligence (AI Accountant)
 * Reads live authenticated financial records and generates concrete, position-based recommendations.
 * Never uses generic canned assumptions.
 */
export function analyzeFinancialPosition(
  snapshot: UserFinancialSnapshot,
  referenceDateIso: string = new Date().toISOString().slice(0, 10),
): AIAccountantAnalysis {
  const monthKey = toMonthKey(referenceDateIso)
  const balances = deriveBalances(snapshot)
  const incomeSummary = buildMonthlyIncomeSummary(snapshot, monthKey)
  const givingSummary = buildMonthlyGivingSummary(snapshot, monthKey)
  const sourceReports = buildIncomeSourceReports(snapshot, monthKey)
  const reconciliation = reconcileMonth(snapshot, monthKey)

  // Calculate monthly personal living expenses & category spending
  let monthlyPersonalExpenses = 0
  const categorySpend = new Map<string, number>()
  for (const tx of snapshot.transactions) {
    if (tx.status === "voided" || tx.monthKey !== monthKey) continue
    if (tx.kind === "personal_expense") {
      monthlyPersonalExpenses += tx.amount
      const catKey = tx.categoryId || tx.categoryName || "Uncategorized"
      categorySpend.set(catKey, (categorySpend.get(catKey) ?? 0) + tx.amount)
    }
  }

  // Evaluate recurring monthly commitments still unpaid in current month
  const activeRecurring = snapshot.recurringExpenses.filter((r) => r.active)
  const unpaidRecurring = activeRecurring.filter(
    (r) => r.lastPaidMonthKey !== monthKey,
  )
  const unpaidRecurringTotal = unpaidRecurring.reduce(
    (sum, r) => sum + r.amount,
    0,
  )
  const totalMonthlyRecurring = activeRecurring.reduce(
    (sum, r) => sum + r.amount,
    0,
  )

  const freeAfterCommitments =
    balances.unallocatedAvailableMoney - unpaidRecurringTotal

  const insights: AIInsightItem[] = []
  let score = 78

  // 1. Available Money & Obligation Coverage Check
  if (balances.unallocatedAvailableMoney < 0) {
    score -= 28
    insights.push({
      id: "negative-unallocated",
      severity: "critical",
      category: "balances",
      title: "Reserved obligations exceed personal cash on hand",
      detail: `Your actual personal balance is ${fmtUgx(balances.actualAccountBalance)}, while unpaid giving obligations (${fmtUgx(balances.reservedObligations)}) and earmarked savings (${fmtUgx(balances.savingsBalances)}) total ${fmtUgx(balances.reservedObligations + balances.savingsBalances)}.`,
      recommendation: `Pause discretionary spending of ${fmtUgx(Math.abs(balances.unallocatedAvailableMoney))} or release earmarked savings before making new commitments.`,
      metricLabel: "Unallocated deficit",
      metricValue: `-${fmtUgx(Math.abs(balances.unallocatedAvailableMoney))}`,
    })
  } else if (freeAfterCommitments < 0 && unpaidRecurringTotal > 0) {
    score -= 15
    insights.push({
      id: "commitment-shortfall",
      severity: "warning",
      category: "recurring",
      title: "Upcoming monthly commitments exceed unallocated cash",
      detail: `You have ${fmtUgx(balances.unallocatedAvailableMoney)} in unallocated available money, and ${unpaidRecurring.length} unpaid recurring commitment(s) totaling ${fmtUgx(unpaidRecurringTotal)} (${unpaidRecurring.map((r) => r.name).join(", ")}).`,
      recommendation: `Prioritize collecting ${fmtUgx(Math.abs(freeAfterCommitments))} in pending receivables or owner withdrawals before due dates.`,
      metricLabel: "Commitment gap",
      metricValue: fmtUgx(Math.abs(freeAfterCommitments)),
    })
  } else if (balances.actualAccountBalance > 0) {
    score += 6
    insights.push({
      id: "healthy-liquidity",
      severity: "positive",
      category: "balances",
      title: "True spendable liquidity is protected",
      detail: `Out of ${fmtUgx(balances.actualAccountBalance)} across your personal accounts, ${fmtUgx(balances.reservedObligations)} is protected for giving and ${fmtUgx(balances.savingsBalances)} is earmarked for savings.`,
      recommendation:
        unpaidRecurringTotal > 0
          ? `After setting aside ${fmtUgx(unpaidRecurringTotal)} for remaining monthly commitments, you can safely deploy ${fmtUgx(freeAfterCommitments)}.`
          : `You have ${fmtUgx(balances.unallocatedAvailableMoney)} genuinely free to budget or allocate toward savings goals.`,
      metricLabel: "Safe spendable",
      metricValue: fmtUgx(Math.max(0, freeAfterCommitments)),
    })
  }

  // 2. Automatic Giving Obligations Analysis
  const unpaidAllocations = snapshot.allocations.filter(
    (a) => a.status === "unpaid",
  )
  if (unpaidAllocations.length > 0) {
    const titheDue = unpaidAllocations
      .filter((a) => a.allocationType === "tithe")
      .reduce((s, a) => s + a.amount, 0)
    const thanksDue = unpaidAllocations
      .filter((a) => a.allocationType === "thanksgiving")
      .reduce((s, a) => s + a.amount, 0)
    const seedDue = unpaidAllocations
      .filter((a) => a.allocationType === "seed")
      .reduce((s, a) => s + a.amount, 0)

    insights.push({
      id: "giving-obligations-due",
      severity:
        balances.actualAccountBalance >= balances.reservedObligations
          ? "opportunity"
          : "warning",
      category: "giving",
      title: `${unpaidAllocations.length} outstanding giving allocation(s) awaiting settlement`,
      detail: `Unpaid obligations total ${fmtUgx(balances.reservedObligations)}: Tithe ${fmtUgx(titheDue)}, Thanksgiving ${fmtUgx(thanksDue)}, and Seed ${fmtUgx(seedDue)}.`,
      recommendation:
        balances.actualAccountBalance >= balances.reservedObligations
          ? `Your personal accounts hold sufficient funds (${fmtUgx(balances.actualAccountBalance)}) to settle all ${fmtUgx(balances.reservedObligations)} without touching unallocated spending money.`
          : `Settle Tithe (${fmtUgx(titheDue)}) first as cash inflows arrive.`,
      metricLabel: "Unpaid giving",
      metricValue: fmtUgx(balances.reservedObligations),
    })
  } else if (givingSummary.totalPaidForMonthIncome > 0) {
    score += 5
    insights.push({
      id: "giving-settled",
      severity: "positive",
      category: "giving",
      title: "100% of giving allocations are settled",
      detail: `You have faithfully paid ${fmtUgx(givingSummary.totalCashPaidInMonth)} in giving this month with zero outstanding obligations.`,
      recommendation: `Your ${snapshot.settings.tithePercent}% / ${snapshot.settings.thanksgivingPercent}% / ${snapshot.settings.seedPercent}% rule will automatically reserve on the next eligible income.`,
      metricLabel: "Paid this month",
      metricValue: fmtUgx(givingSummary.totalCashPaidInMonth),
    })
  }

  // 3. Income Stream Concentration & Business Earnings Separation
  if (incomeSummary.totalEligiblePersonalIncome > 0) {
    const activeSources = sourceReports.filter(
      (s) => s.eligiblePersonalIncome > 0,
    )
    const topSource = activeSources[0]
    if (topSource) {
      const share = Math.round(
        (topSource.eligiblePersonalIncome /
          incomeSummary.totalEligiblePersonalIncome) *
          100,
      )
      insights.push({
        id: "income-concentration",
        severity: share > 85 && activeSources.length === 1 ? "opportunity" : "positive",
        category: "income",
        title:
          activeSources.length > 1
            ? `${activeSources.length} active personal income streams recorded`
            : `Single-stream reliance on ${topSource.sourceName} (${share}%)`,
        detail: `${topSource.sourceName} contributed ${fmtUgx(topSource.eligiblePersonalIncome)} (${share}%) of your ${fmtUgx(incomeSummary.totalEligiblePersonalIncome)} monthly personal income.`,
        recommendation:
          share > 85
            ? `Channel at least 10% of ${topSource.sourceName} net inflows into an Emergency Savings Goal to buffer single-source risk.`
            : `Maintain separate source tagging across all ${activeSources.length} streams to track net yield per stream.`,
        metricLabel: "Top stream share",
        metricValue: `${share}%`,
      })
    }
  }

  if (
    incomeSummary.businessGrossRevenue > 0 ||
    balances.businessRetainedBalance > 0
  ) {
    insights.push({
      id: "business-separation",
      severity: "opportunity",
      category: "business",
      title: "Business gross revenue cleanly separated from personal income",
      detail: `This month recorded ${fmtUgx(incomeSummary.businessGrossRevenue)} gross business revenue, ${fmtUgx(incomeSummary.projectCosts)} in project costs, and ${fmtUgx(incomeSummary.ownerWithdrawals)} in personal owner withdrawals. Retained business balance stands at ${fmtUgx(balances.businessRetainedBalance)}.`,
      recommendation:
        balances.businessRetainedBalance > 0
          ? `Keep working capital for upcoming project costs in your Business account; only record an Owner Withdrawal when taking personal pay (which will reserve ${snapshot.settings.tithePercent + snapshot.settings.thanksgivingPercent + snapshot.settings.seedPercent}% giving).`
          : `Ensure project costs remain covered before taking additional owner withdrawals.`,
      metricLabel: "Retained business",
      metricValue: fmtUgx(balances.businessRetainedBalance),
    })
  }

  // 4. Savings Goals Progress
  if (snapshot.savingsGoals.length > 0) {
    const totalTarget = snapshot.savingsGoals.reduce(
      (s, g) => s + g.targetAmount,
      0,
    )
    const pct =
      totalTarget > 0
        ? Math.min(100, Math.round((balances.savingsBalances / totalTarget) * 100))
        : 0
    const remainingGoal = Math.max(0, totalTarget - balances.savingsBalances)

    insights.push({
      id: "savings-progress",
      severity: pct >= 50 ? "positive" : "opportunity",
      category: "savings",
      title: `Savings goals are ${pct}% funded across ${snapshot.savingsGoals.length} target(s)`,
      detail: `Earmarked savings stand at ${fmtUgx(balances.savingsBalances)} against ${fmtUgx(totalTarget)} total goal targets (${fmtUgx(remainingGoal)} remaining).`,
      recommendation:
        freeAfterCommitments > 50000 && remainingGoal > 0
          ? `You can earmark ${fmtUgx(Math.min(remainingGoal, Math.round(freeAfterCommitments * 0.25)))} (25% of your free surplus) toward "${snapshot.savingsGoals[0].name}" today.`
          : `Continue earmarking surplus unallocated funds once monthly commitments are cleared.`,
      metricLabel: "Goals funded",
      metricValue: `${pct}%`,
    })
  }

  // 5. Budget Burn Check
  for (const budget of snapshot.budgets) {
    if (budget.monthKey !== "default" && budget.monthKey !== monthKey) continue
    const spent =
      categorySpend.get(budget.categoryId) ??
      categorySpend.get(budget.categoryName) ??
      0
    if (budget.limitAmount > 0 && spent > budget.limitAmount) {
      score -= 8
      insights.push({
        id: `over-budget-${budget.id}`,
        severity: "warning",
        category: "balances",
        title: `${budget.categoryName} exceeded monthly budget`,
        detail: `Actual spending in ${budget.categoryName} is ${fmtUgx(spent)} against a budget cap of ${fmtUgx(budget.limitAmount)} (+${fmtUgx(spent - budget.limitAmount)} over).`,
        recommendation: `Offset this overrun by trimming discretionary categories or revising the ${budget.categoryName} cap.`,
        metricLabel: "Over budget",
        metricValue: `+${fmtUgx(spent - budget.limitAmount)}`,
      })
    }
  }

  // 6. Entrusted Stewardship Check
  if (snapshot.entrustedFunds.length > 0 && balances.entrustedBalances > 0) {
    insights.push({
      id: "entrusted-stewardship",
      severity: "positive",
      category: "entrusted",
      title: `${fmtUgx(balances.entrustedBalances)} in entrusted funds strictly ring-fenced`,
      detail: `Across ${snapshot.entrustedFunds.filter((f) => f.status === "active").length} active custodial fund(s), entrusted balances are 100% excluded from your personal net worth and giving engine.`,
      recommendation: `Verify physical custodial cash/MoMo matches ${fmtUgx(balances.entrustedBalances)} separately from your ${fmtUgx(balances.actualAccountBalance)} personal balance.`,
      metricLabel: "Entrusted custody",
      metricValue: fmtUgx(balances.entrustedBalances),
    })
  }

  const clampedScore = Math.max(15, Math.min(99, score))

  const hasActivity = snapshot.transactions.some((t) => t.status !== "voided")

  const headline = !hasActivity
    ? "Ledger initialized — record your first income or opening balance"
    : balances.unallocatedAvailableMoney < 0
      ? `Attention needed: obligations exceed personal cash by ${fmtUgx(Math.abs(balances.unallocatedAvailableMoney))}`
      : `${fmtUgx(balances.unallocatedAvailableMoney)} unallocated & available after reserving ${fmtUgx(balances.reservedObligations)} in giving`

  const executiveSummary = !hasActivity
    ? `Your authenticated PHENAXIS ledger is active and reconciled. Record personal income to automatically reserve ${snapshot.settings.tithePercent}% Tithe, ${snapshot.settings.thanksgivingPercent}% Thanksgiving, and ${snapshot.settings.seedPercent}% Seed, or add an Opening Balance on your accounts.`
    : `For ${monthKey}, you recorded ${fmtUgx(incomeSummary.totalEligiblePersonalIncome)} in eligible personal income and ${fmtUgx(monthlyPersonalExpenses)} in personal living expenses (${reconciliation.isReconciled ? "100% ledger reconciled" : "check reconciliation"}). Actual personal balance is ${fmtUgx(balances.actualAccountBalance)}, with ${fmtUgx(balances.reservedObligations)} reserved for unpaid giving, ${fmtUgx(balances.savingsBalances)} in savings goals, and ${fmtUgx(totalMonthlyRecurring)} in tracked monthly recurring commitments.`

  return {
    generatedAt: new Date().toISOString(),
    monthKey,
    healthScore: clampedScore,
    headline,
    executiveSummary,
    keyMetrics: {
      actualPersonalBalance: balances.actualAccountBalance,
      reservedObligations: balances.reservedObligations,
      savingsBalances: balances.savingsBalances,
      unallocatedAvailable: balances.unallocatedAvailableMoney,
      entrustedBalances: balances.entrustedBalances,
      businessRetainedBalance: balances.businessRetainedBalance,
      monthlyEligibleIncome: incomeSummary.totalEligiblePersonalIncome,
      monthlyPersonalExpenses,
      unpaidRecurringCommitments: unpaidRecurringTotal,
      freeAfterCommitments,
    },
    insights,
  }
}

/**
 * Answers natural-language questions from the user using exact figures from their authenticated ledger.
 */
export function answerAccountantQuery(
  query: string,
  snapshot: UserFinancialSnapshot,
  referenceDateIso: string = new Date().toISOString().slice(0, 10),
): string {
  const q = query.toLowerCase().trim()
  const analysis = analyzeFinancialPosition(snapshot, referenceDateIso)
  const m = analysis.keyMetrics
  const monthKey = analysis.monthKey
  const giving = buildMonthlyGivingSummary(snapshot, monthKey)
  const income = buildMonthlyIncomeSummary(snapshot, monthKey)
  const sources = buildIncomeSourceReports(snapshot)

  // Check if user is asking "can I afford / spend UGX X?"
  const numberMatch = q.replace(/,/g, "").match(/(\d{4,12})/)
  if (
    numberMatch &&
    (q.includes("afford") ||
      q.includes("spend") ||
      q.includes("buy") ||
      q.includes("pay"))
  ) {
    const requested = Number(numberMatch[1])
    const afterSpend = m.freeAfterCommitments - requested
    if (afterSpend >= 0) {
      return `Yes — based on your live records, you can afford ${fmtUgx(requested)}. Your Actual Personal Balance is ${fmtUgx(m.actualPersonalBalance)}; after subtracting ${fmtUgx(m.reservedObligations)} in unpaid giving obligations, ${fmtUgx(m.savingsBalances)} in earmarked savings, and ${fmtUgx(m.unpaidRecurringCommitments)} in remaining monthly recurring commitments, you have ${fmtUgx(m.freeAfterCommitments)} safely available. Spending ${fmtUgx(requested)} leaves a ${fmtUgx(afterSpend)} buffer.`
    }
    return `Not safely right now. Although your Actual Personal Balance is ${fmtUgx(m.actualPersonalBalance)}, ${fmtUgx(m.reservedObligations)} is reserved for unpaid giving obligations, ${fmtUgx(m.savingsBalances)} is earmarked for savings goals, and ${fmtUgx(m.unpaidRecurringCommitments)} is needed for unpaid monthly recurring expenses — leaving ${fmtUgx(m.freeAfterCommitments)} free. Spending ${fmtUgx(requested)} would create a shortfall of ${fmtUgx(Math.abs(afterSpend))}.`
  }

  if (
    q.includes("tithe") ||
    q.includes("giving") ||
    q.includes("seed") ||
    q.includes("thanksgiving") ||
    q.includes("allocation") ||
    q.includes("obligation")
  ) {
    return `Giving Position (${monthKey}): Total unpaid giving obligations across all records stand at ${fmtUgx(giving.allTimeUnpaidObligations)} (Tithe unpaid: ${fmtUgx(snapshot.allocations.filter((a) => a.status === "unpaid" && a.allocationType === "tithe").reduce((s, a) => s + a.amount, 0))}, Thanksgiving unpaid: ${fmtUgx(snapshot.allocations.filter((a) => a.status === "unpaid" && a.allocationType === "thanksgiving").reduce((s, a) => s + a.amount, 0))}, Seed unpaid: ${fmtUgx(snapshot.allocations.filter((a) => a.status === "unpaid" && a.allocationType === "seed").reduce((s, a) => s + a.amount, 0))}). In ${monthKey}, ${fmtUgx(giving.totalAllocated)} was reserved from ${fmtUgx(income.totalEligiblePersonalIncome)} of eligible personal income, and ${fmtUgx(giving.totalCashPaidInMonth)} has been confirmed paid. Your active rule is ${snapshot.settings.tithePercent}% Tithe / ${snapshot.settings.thanksgivingPercent}% Thanksgiving / ${snapshot.settings.seedPercent}% Seed.`
  }

  if (q.includes("income") || q.includes("source") || q.includes("business") || q.includes("stream")) {
    const topLines = sources
      .filter((s) => s.eligiblePersonalIncome > 0 || s.businessGrossRevenue > 0)
      .slice(0, 4)
      .map(
        (s) =>
          `${s.sourceName}: ${fmtUgx(s.eligiblePersonalIncome)} personal income` +
          (s.businessGrossRevenue > 0
            ? ` (${fmtUgx(s.businessGrossRevenue)} gross biz revenue, ${fmtUgx(s.projectCosts)} project costs, ${fmtUgx(s.retainedBusinessEarnings)} retained)`
            : ""),
      )
      .join(" · ")
    return `Income Analysis (${monthKey}): Eligible personal income this month is ${fmtUgx(income.totalEligiblePersonalIncome)}. Business gross revenue is ${fmtUgx(income.businessGrossRevenue)} (excluded from personal income) with ${fmtUgx(income.projectCosts)} in project costs and ${fmtUgx(income.ownerWithdrawals)} withdrawn personally. ${topLines ? `Active sources — ${topLines}.` : "No income sources have transactions yet."}`
  }

  if (q.includes("saving") || q.includes("goal")) {
    if (snapshot.savingsGoals.length === 0) {
      return `You currently have 0 savings goals configured and ${fmtUgx(m.unallocatedAvailable)} in unallocated available money. Create a Savings Goal in the Finance > Savings & Recurring tab to earmark funds.`
    }
    const balances = deriveBalances(snapshot)
    const breakdown = snapshot.savingsGoals
      .map((g) => {
        const saved = balances.savingsGoalBalances[g.id] ?? 0
        return `${g.name}: ${fmtUgx(saved)} / ${fmtUgx(g.targetAmount)} (${g.targetAmount > 0 ? Math.round((saved / g.targetAmount) * 100) : 0}%)`
      })
      .join(" · ")
    return `Savings Goals Position: ${fmtUgx(m.savingsBalances)} total earmarked across ${snapshot.savingsGoals.length} goal(s) — ${breakdown}. You have ${fmtUgx(Math.max(0, m.freeAfterCommitments))} free after recurring commitments to contribute further.`
  }

  if (q.includes("entrusted") || q.includes("custod")) {
    return `Entrusted Stewardship: You hold ${fmtUgx(m.entrustedBalances)} across ${snapshot.entrustedFunds.filter((f) => f.status === "active").length} active entrusted fund(s). These funds are 100% ring-fenced from your ${fmtUgx(m.actualPersonalBalance)} personal balance and never trigger personal giving allocations.`
  }

  return `${analysis.headline}. ${analysis.executiveSummary} Free cash after remaining monthly recurring commitments (${fmtUgx(m.unpaidRecurringCommitments)}) is ${fmtUgx(m.freeAfterCommitments)}.`
}

