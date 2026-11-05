import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
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
} from "../domain/ledgerEngine"
import { USER_COLLECTIONS } from "../domain/types"
import { PhenaxisAuthService } from "../services/authService"
import {
  KeyValuePersistence,
  PhenaxisRepository,
} from "../services/phenaxisRepository"

class TestStorage implements KeyValuePersistence {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

function createIsolatedHarness(sharedStorage?: TestStorage) {
  const storage = sharedStorage ?? new TestStorage()
  const auth = new PhenaxisAuthService({
    persistence: storage,
    forceLocalVault: true,
  })
  const repo = new PhenaxisRepository({
    persistence: storage,
    forceLocalVault: true,
    getAuthenticatedUid: () => auth.getCurrentUser()?.uid ?? null,
  })
  return { storage, auth, repo }
}

describe("PHENAXIS Approved Financial Architecture — Acceptance Suite", () => {
  it("1. Recording UGX 500,000 of eligible income creates exact UGX 100,000 in 3 linked giving allocations", async () => {
    const { auth, repo } = createIsolatedHarness()
    const user = await auth.registerWithEmail({
      email: "steward@phenaxis.ug",
      password: "password123",
      displayName: "Andrew K.",
    })
    await repo.ensureUserInitialized(user.uid, user.displayName)

    const res = await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_salary_1",
      title: "May Employment Salary",
      description: "Monthly engineering salary",
      amount: 500_000,
      date: "2026-11-05",
      accountId: "acc_stanbic",
      incomeSourceId: "src_employment",
      incomeType: "employment_salary",
    })

    expect(res.allocations).toHaveLength(3)
    const tithe = res.allocations.find((a) => a.allocationType === "tithe")!
    const thanks = res.allocations.find(
      (a) => a.allocationType === "thanksgiving",
    )!
    const seed = res.allocations.find((a) => a.allocationType === "seed")!

    expect(tithe.amount).toBe(50_000)
    expect(thanks.amount).toBe(25_000)
    expect(seed.amount).toBe(25_000)
    expect(tithe.amount + thanks.amount + seed.amount).toBe(100_000)
    expect(tithe.sourceTransactionId).toBe(res.transaction.id)
    expect(thanks.sourceTransactionId).toBe(res.transaction.id)
    expect(seed.sourceTransactionId).toBe(res.transaction.id)

    const snap = await repo.getSnapshot(user.uid)
    const balances = deriveBalances(snap)
    expect(balances.actualAccountBalance).toBe(500_000)
    expect(balances.reservedObligations).toBe(100_000)
    expect(balances.unallocatedAvailableMoney).toBe(400_000)
  })

  it("2. Recording a second income creates its own allocations without duplicating the first + enforces idempotency", async () => {
    const { auth, repo } = createIsolatedHarness()
    const user = await auth.registerWithEmail({
      email: "second@phenaxis.ug",
      password: "password123",
      displayName: "Sarah N.",
    })
    await repo.ensureUserInitialized(user.uid, user.displayName)

    const first = await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_inc_1",
      title: "Salary Payment",
      description: "First income",
      amount: 500_000,
      date: "2026-11-01",
      accountId: "acc_stanbic",
      incomeSourceId: "src_employment",
      incomeType: "employment_salary",
    })

    // Replay with identical idempotency key -> no duplicate created
    const replay = await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_inc_1",
      title: "Salary Payment",
      description: "First income",
      amount: 500_000,
      date: "2026-11-01",
      accountId: "acc_stanbic",
      incomeSourceId: "src_employment",
      incomeType: "employment_salary",
    })
    expect(replay.wasIdempotentReplay).toBe(true)
    expect(replay.transaction.id).toBe(first.transaction.id)

    // Record second distinct income (UGX 300,000 freelance)
    const second = await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_inc_2",
      title: "UI Design Milestone",
      description: "Freelance deliverable",
      amount: 300_000,
      date: "2026-11-04",
      accountId: "acc_mtn_momo",
      incomeSourceId: "src_freelance",
      incomeType: "freelance_earnings",
    })

    const snap = await repo.getSnapshot(user.uid)
    expect(snap.transactions).toHaveLength(2)
    expect(snap.allocations).toHaveLength(6)

    const firstAllocs = snap.allocations.filter(
      (a) => a.sourceTransactionId === first.transaction.id,
    )
    const secondAllocs = snap.allocations.filter(
      (a) => a.sourceTransactionId === second.transaction.id,
    )
    expect(firstAllocs).toHaveLength(3)
    expect(secondAllocs).toHaveLength(3)
    expect(firstAllocs.reduce((s, a) => s + a.amount, 0)).toBe(100_000)
    expect(secondAllocs.reduce((s, a) => s + a.amount, 0)).toBe(60_000)

    const balances = deriveBalances(snap)
    expect(balances.actualAccountBalance).toBe(800_000)
    expect(balances.reservedObligations).toBe(160_000)
    expect(balances.unallocatedAvailableMoney).toBe(640_000)
  })

  it("3. Entrusted money, loans, reimbursements, refunds, and business gross revenue create NO personal giving allocation", async () => {
    const { auth, repo } = createIsolatedHarness()
    const user = await auth.registerWithEmail({
      email: "custodian@phenaxis.ug",
      password: "password123",
      displayName: "Peter M.",
    })
    await repo.ensureUserInitialized(user.uid, user.displayName)

    const nowIso = new Date().toISOString()
    await repo.saveEntity(user.uid, "entrusted_funds", {
      id: "fund_youth_camp",
      ownerUid: user.uid,
      name: "Church Youth Camp",
      purpose: "Annual youth retreat logistics",
      stewardFor: "St. Luke Youth Ministry",
      icon: "church",
      color: "violet",
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    // Entrusted inflow: UGX 1,200,000
    await repo.recordEntrustedMovement(user.uid, {
      idempotencyKey: "idem_ent_in_1",
      entrustedFundId: "fund_youth_camp",
      direction: "in",
      amount: 1_200_000,
      date: "2026-11-02",
      title: "Camp Registration Contributions",
      description: "Collected from 24 participants",
    })

    // Entrusted outflow: UGX 350,000
    await repo.recordEntrustedMovement(user.uid, {
      idempotencyKey: "idem_ent_out_1",
      entrustedFundId: "fund_youth_camp",
      direction: "out",
      amount: 350_000,
      date: "2026-11-03",
      title: "Transport Deposit",
      description: "Coaster bus booking",
    })

    // Loan proceeds, reimbursement, refund -> personal cash inflows, NOT personal income
    await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_loan_1",
      title: "SACCO Short-Term Loan",
      description: "Borrowed capital",
      amount: 1_000_000,
      date: "2026-11-03",
      accountId: "acc_stanbic",
      incomeSourceId: "src_employment",
      incomeType: "loan_proceeds",
    })
    await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_reimb_1",
      title: "Travel Reimbursement",
      description: "Employer fuel refund",
      amount: 120_000,
      date: "2026-11-04",
      accountId: "acc_mtn_momo",
      incomeSourceId: "src_employment",
      incomeType: "reimbursement",
    })
    await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_refund_1",
      title: "Vendor Order Refund",
      description: "Returned faulty cable",
      amount: 45_000,
      date: "2026-11-04",
      accountId: "acc_airtel_money",
      incomeSourceId: "src_employment",
      incomeType: "refund",
    })

    // Business gross revenue + project cost -> business ledger, NOT personal income
    await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_biz_rev_1",
      title: "Web Platform Contract Invoice #104",
      description: "Gross client payment into business account",
      amount: 2_500_000,
      date: "2026-11-04",
      accountId: "acc_business_ops",
      incomeSourceId: "src_business",
      incomeType: "business_gross_revenue",
    })
    await repo.recordExpense(user.uid, {
      idempotencyKey: "idem_proj_cost_1",
      title: "Cloud Hosting & Domain Provisioning",
      description: "Direct project cost",
      amount: 600_000,
      date: "2026-11-04",
      accountId: "acc_business_ops",
      categoryId: "cat_project_cost",
      isProjectCost: true,
      incomeSourceId: "src_business",
    })

    const snapAfterNonPersonal = await repo.getSnapshot(user.uid)
    expect(snapAfterNonPersonal.allocations).toHaveLength(0)

    const bal1 = deriveBalances(snapAfterNonPersonal)
    expect(bal1.entrustedBalances).toBe(850_000) // 1,200,000 - 350,000
    expect(bal1.businessRetainedBalance).toBe(1_900_000) // 2,500,000 - 600,000
    expect(bal1.actualAccountBalance).toBe(1_165_000) // loan + reimb + refund only
    expect(bal1.reservedObligations).toBe(0)

    const monthlyInc1 = buildMonthlyIncomeSummary(snapAfterNonPersonal, "2026-11")
    expect(monthlyInc1.totalEligiblePersonalIncome).toBe(0)
    expect(monthlyInc1.businessGrossRevenue).toBe(2_500_000)
    expect(monthlyInc1.projectCosts).toBe(600_000)
    expect(monthlyInc1.netBusinessEarnings).toBe(1_900_000)

    // Now take a personal Owner Withdrawal of UGX 500,000 from Business Operating -> Stanbic Bank
    await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_owner_draw_1",
      title: "Owner Draw from Contract #104",
      description: "Personal withdrawal from net business earnings",
      amount: 500_000,
      date: "2026-11-05",
      accountId: "acc_stanbic",
      incomeSourceId: "src_business",
      incomeType: "owner_withdrawal",
      sourceBusinessAccountId: "acc_business_ops",
    })

    const snapAfterDraw = await repo.getSnapshot(user.uid)
    expect(snapAfterDraw.allocations).toHaveLength(3)
    const bal2 = deriveBalances(snapAfterDraw)
    expect(bal2.businessRetainedBalance).toBe(1_400_000) // 1,900,000 - 500,000
    expect(bal2.actualAccountBalance).toBe(1_665_000) // 1,165,000 + 500,000
    expect(bal2.reservedObligations).toBe(100_000) // 20% of 500,000 owner withdrawal
  })

  it("4. Transfers create NO new income and NO giving allocations while preserving total balance", async () => {
    const { auth, repo } = createIsolatedHarness()
    const user = await auth.registerWithEmail({
      email: "transfers@phenaxis.ug",
      password: "password123",
      displayName: "Grace A.",
    })
    await repo.ensureUserInitialized(user.uid, user.displayName)

    await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_sal_transfer_test",
      title: "Salary",
      description: "Monthly pay",
      amount: 1_000_000,
      date: "2026-11-01",
      accountId: "acc_stanbic",
      incomeSourceId: "src_employment",
      incomeType: "employment_salary",
    })

    await repo.recordTransfer(user.uid, {
      idempotencyKey: "idem_trf_1",
      amount: 350_000,
      date: "2026-11-02",
      fromAccountId: "acc_stanbic",
      toAccountId: "acc_mtn_momo",
      description: "Top up Mobile Money wallet",
    })

    const snap = await repo.getSnapshot(user.uid)
    const balances = deriveBalances(snap)
    const incomeSummary = buildMonthlyIncomeSummary(snap, "2026-11")

    expect(balances.accountBalances["acc_stanbic"]).toBe(650_000)
    expect(balances.accountBalances["acc_mtn_momo"]).toBe(350_000)
    expect(balances.actualAccountBalance).toBe(1_000_000)
    expect(incomeSummary.totalEligiblePersonalIncome).toBe(1_000_000)
    expect(snap.allocations).toHaveLength(3)
    expect(balances.reservedObligations).toBe(200_000)
  })

  it("5. Paying an allocation reduces the account balance exact once and prevents double payment", async () => {
    const { auth, repo } = createIsolatedHarness()
    const user = await auth.registerWithEmail({
      email: "giving@phenaxis.ug",
      password: "password123",
      displayName: "David O.",
    })
    await repo.ensureUserInitialized(user.uid, user.displayName)

    const { allocations } = await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "idem_pay_test_inc",
      title: "Consulting Fee",
      description: "Advisory project",
      amount: 500_000,
      date: "2026-11-03",
      accountId: "acc_stanbic",
      incomeSourceId: "src_creative",
      incomeType: "creative_technical_services",
    })

    const titheAlloc = allocations.find((a) => a.allocationType === "tithe")!
    expect(titheAlloc.amount).toBe(50_000)

    // Confirm payment of UGX 50,000 Tithe
    await repo.payAllocation(user.uid, {
      idempotencyKey: "idem_pay_tithe_1",
      allocationId: titheAlloc.id,
      paidFromAccountId: "acc_stanbic",
      date: "2026-11-05",
      notes: "Paid via Stanbic Church Merchant Code",
    })

    const snap = await repo.getSnapshot(user.uid)
    const balances = deriveBalances(snap)

    // Account balance reduced ONCE: 500,000 - 50,000 = 450,000
    expect(balances.actualAccountBalance).toBe(450_000)
    // Remaining unpaid obligations: 25,000 Thanksgiving + 25,000 Seed = 50,000
    expect(balances.reservedObligations).toBe(50_000)
    // Unallocated available money was 400,000 before payment and remains 400,000 (not deducted twice!)
    expect(balances.unallocatedAvailableMoney).toBe(400_000)

    // Attempting to pay the same allocation again with a new idempotency key MUST fail
    await expect(
      repo.payAllocation(user.uid, {
        idempotencyKey: "idem_pay_tithe_duplicate_attempt",
        allocationId: titheAlloc.id,
        paidFromAccountId: "acc_stanbic",
        date: "2026-11-05",
      }),
    ).rejects.toThrow(/ALREADY_PAID/)
  })

  it("6. Refreshing or reopening the application preserves all records, settings, and balances", async () => {
    const sharedStorage = new TestStorage()

    // Session 1: Create user, customize giving % in settings, record income + savings goal
    const session1 = createIsolatedHarness(sharedStorage)
    const user1 = await session1.auth.registerWithEmail({
      email: "persist@phenaxis.ug",
      password: "password123",
      displayName: "Ruth K.",
    })
    await session1.repo.ensureUserInitialized(user1.uid, user1.displayName)
    await session1.repo.updateSettings(user1.uid, {
      tithePercent: 10,
      thanksgivingPercent: 8,
      seedPercent: 7, // Total 25%
    })
    await session1.repo.recordIncomeOrInflow(user1.uid, {
      idempotencyKey: "idem_persist_inc",
      title: "Ministry Allowance",
      description: "November stipend",
      amount: 400_000,
      date: "2026-11-04",
      accountId: "acc_mtn_momo",
      incomeSourceId: "src_ministry",
      incomeType: "ministry_allowances",
    })

    // Simulate browser reload: brand new service instances reading from sharedStorage
    const session2 = createIsolatedHarness(sharedStorage)
    let restoredUserUid: string | null = null
    const unsub = session2.auth.subscribe((u) => {
      restoredUserUid = u?.uid ?? null
    })
    unsub()

    expect(restoredUserUid).toBe(user1.uid)
    const restoredSnap = await session2.repo.getSnapshot(user1.uid)
    expect(restoredSnap.settings.thanksgivingPercent).toBe(8)
    expect(restoredSnap.settings.seedPercent).toBe(7)
    expect(restoredSnap.transactions).toHaveLength(1)
    expect(restoredSnap.allocations).toHaveLength(3)

    const restoredBalances = deriveBalances(restoredSnap)
    expect(restoredBalances.actualAccountBalance).toBe(400_000)
    expect(restoredBalances.reservedObligations).toBe(100_000) // 25% of 400,000
    expect(restoredBalances.unallocatedAvailableMoney).toBe(300_000)
  })

  it("7. Different authenticated users cannot access each other's data + Firestore rules enforce strict uid isolation", async () => {
    const sharedStorage = new TestStorage()
    const { auth, repo } = createIsolatedHarness(sharedStorage)

    // User A signs up and records UGX 2,000,000 salary
    const userA = await auth.registerWithEmail({
      email: "alice@phenaxis.ug",
      password: "password123",
      displayName: "Alice",
    })
    await repo.ensureUserInitialized(userA.uid, userA.displayName)
    await repo.recordIncomeOrInflow(userA.uid, {
      idempotencyKey: "alice_inc_1",
      title: "Alice Confidential Salary",
      description: "Private payroll",
      amount: 2_000_000,
      date: "2026-11-05",
      accountId: "acc_stanbic",
      incomeSourceId: "src_employment",
      incomeType: "employment_salary",
    })
    await auth.signOut()

    // User B signs up on the same device/storage
    const userB = await auth.registerWithEmail({
      email: "bob@phenaxis.ug",
      password: "password123",
      displayName: "Bob",
    })
    await repo.ensureUserInitialized(userB.uid, userB.displayName)

    // User B's own ledger is completely clean (0 transactions, 0 balance)
    const bobSnap = await repo.getSnapshot(userB.uid)
    expect(bobSnap.transactions).toHaveLength(0)
    expect(deriveBalances(bobSnap).actualAccountBalance).toBe(0)

    // User B attempting to read or mutate User A's path throws PERMISSION_DENIED
    await expect(repo.getSnapshot(userA.uid)).rejects.toThrow(
      /PERMISSION_DENIED/,
    )
    await expect(
      repo.recordExpense(userA.uid, {
        idempotencyKey: "cross_attack",
        title: "Unauthorized spend",
        description: "Should fail",
        amount: 50_000,
        date: "2026-11-05",
        accountId: "acc_stanbic",
        categoryId: "cat_personal",
      }),
    ).rejects.toThrow(/PERMISSION_DENIED/)

    // Verify firestore.rules covers every single required collection under users/{uid}/
    const rulesText = readFileSync(
      resolve(process.cwd(), "firestore.rules"),
      "utf8",
    )
    expect(rulesText).toContain("request.auth != null && request.auth.uid == uid")
    for (const col of USER_COLLECTIONS) {
      expect(rulesText).toContain(`match /${col}/`)
    }
  })

  it("8. Monthly reports, auditable corrections, savings goals, and AI Accountant reconcile 100% with transaction records", async () => {
    const { auth, repo } = createIsolatedHarness()
    const user = await auth.registerWithEmail({
      email: "reconcile@phenaxis.ug",
      password: "password123",
      displayName: "Stephen W.",
    })
    await repo.ensureUserInitialized(user.uid, user.displayName)

    // Prior month (Oct 2026) opening activity: +1,000,000 salary, -200,000 rent = 800,000 closing Oct balance
    await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "oct_sal",
      title: "October Salary",
      description: "Prior month salary",
      amount: 1_000_000,
      date: "2026-10-28",
      accountId: "acc_stanbic",
      incomeSourceId: "src_employment",
      incomeType: "employment_salary",
    })
    await repo.recordExpense(user.uid, {
      idempotencyKey: "oct_exp",
      title: "October Utilities",
      description: "Power & water",
      amount: 200_000,
      date: "2026-10-30",
      accountId: "acc_stanbic",
      categoryId: "cat_utilities",
    })

    // Current month (Nov 2026) activity:
    // +1,500,000 Salary, +400,000 Freelance (subsequently corrected to 500,000!), -450,000 Groceries,
    // Transfer 300,000 Stanbic -> MTN MoMo, Pay Nov Salary Tithe (150,000), Earmark 250,000 Savings Goal
    const novSal = await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "nov_sal",
      title: "November Salary",
      description: "Monthly salary",
      amount: 1_500_000,
      date: "2026-11-01",
      accountId: "acc_stanbic",
      incomeSourceId: "src_employment",
      incomeType: "employment_salary",
    })

    const novFreelance = await repo.recordIncomeOrInflow(user.uid, {
      idempotencyKey: "nov_free",
      title: "API Integration Project",
      description: "Initial entry",
      amount: 400_000,
      date: "2026-11-02",
      accountId: "acc_mtn_momo",
      incomeSourceId: "src_freelance",
      incomeType: "client_projects",
    })

    // Auditable correction: 400,000 -> 500,000
    const correctedTx = await repo.correctTransaction(user.uid, {
      transactionId: novFreelance.transaction.id,
      newAmount: 500_000,
      newTitle: "API Integration Project (Final)",
      newDescription: "Included final milestone bonus",
      newDate: "2026-11-02",
      reason: "Client included UGX 100,000 bonus on mobile money receipt",
    })
    expect(correctedTx.status).toBe("corrected")
    expect(correctedTx.auditTrail).toHaveLength(2)

    await repo.recordExpense(user.uid, {
      idempotencyKey: "nov_groc",
      title: "Monthly Groceries",
      description: "Supermarket",
      amount: 450_000,
      date: "2026-11-03",
      accountId: "acc_mtn_momo",
      categoryId: "cat_food",
    })

    await repo.recordTransfer(user.uid, {
      idempotencyKey: "nov_trf",
      amount: 300_000,
      date: "2026-11-04",
      fromAccountId: "acc_stanbic",
      toAccountId: "acc_mtn_momo",
      description: "MoMo float",
    })

    const novSalTithe = novSal.allocations.find(
      (a) => a.allocationType === "tithe",
    )!
    await repo.payAllocation(user.uid, {
      idempotencyKey: "nov_pay_tithe",
      allocationId: novSalTithe.id,
      paidFromAccountId: "acc_stanbic",
      date: "2026-11-05",
    })

    const nowIso = new Date().toISOString()
    await repo.saveEntity(user.uid, "savings_goals", {
      id: "goal_emergency",
      ownerUid: user.uid,
      name: "Emergency Fund",
      targetAmount: 3_000_000,
      targetDate: "2027-06-30",
      linkedAccountId: "acc_stanbic",
      color: "green",
      notes: "6 months buffer",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    await repo.recordSavingsMovement(user.uid, {
      idempotencyKey: "nov_sav_1",
      savingsGoalId: "goal_emergency",
      direction: "deposit",
      amount: 250_000,
      date: "2026-11-05",
      accountId: "acc_stanbic",
      notes: "Monthly savings earmark",
    })

    await repo.saveEntity(user.uid, "recurring_expenses", {
      id: "rec_internet",
      ownerUid: user.uid,
      name: "Fiber Internet",
      categoryId: "cat_utilities",
      categoryName: "Utilities & Internet",
      defaultAccountId: "acc_mtn_momo",
      amount: 150_000,
      dueDayOfMonth: 15,
      frequency: "monthly",
      active: true,
      lastPaidMonthKey: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })

    const snap = await repo.getSnapshot(user.uid)
    const recon = reconcileMonth(snap, "2026-11")
    const incSummary = buildMonthlyIncomeSummary(snap, "2026-11")
    const givSummary = buildMonthlyGivingSummary(snap, "2026-11")
    const sourceReport = buildIncomeSourceReports(snap, "2026-11")
    const balances = deriveBalances(snap)

    expect(recon.isReconciled).toBe(true)
    expect(recon.variance).toBe(0)
    expect(recon.openingPersonalBalance).toBe(800_000)
    expect(recon.eligiblePersonalIncome).toBe(2_000_000) // 1,500,000 + corrected 500,000
    expect(recon.personalLivingExpenses).toBe(450_000)
    expect(recon.givingPaymentsOutflow).toBe(150_000)
    expect(recon.personalTransfersIn).toBe(300_000)
    expect(recon.personalTransfersOut).toBe(300_000)
    expect(recon.actualClosingPersonalBalance).toBe(2_200_000) // 800k + 2,000k - 450k - 150k

    expect(incSummary.totalEligiblePersonalIncome).toBe(2_000_000)
    expect(givSummary.totalAllocated).toBe(400_000) // 20% of 2,000,000
    expect(givSummary.totalCashPaidInMonth).toBe(150_000)
    expect(givSummary.allTimeUnpaidObligations).toBe(450_000) // 200k (Oct) + 400k (Nov) - 150k (paid)

    expect(balances.actualAccountBalance).toBe(2_200_000)
    expect(balances.reservedObligations).toBe(450_000)
    expect(balances.savingsBalances).toBe(250_000)
    expect(balances.unallocatedAvailableMoney).toBe(1_500_000) // 2,200k - 450k - 250k
    expect(sourceReport.find((r) => r.sourceId === "src_freelance")?.eligiblePersonalIncome).toBe(500_000)

    // AI Accountant reads live figures accurately
    const ai = analyzeFinancialPosition(snap, "2026-11-05")
    expect(ai.keyMetrics.actualPersonalBalance).toBe(2_200_000)
    expect(ai.keyMetrics.unpaidRecurringCommitments).toBe(150_000)
    expect(ai.keyMetrics.freeAfterCommitments).toBe(1_350_000) // 1,500k - 150k internet

    const answerYes = answerAccountantQuery(
      "Can I afford UGX 500,000 right now?",
      snap,
      "2026-11-05",
    )
    expect(answerYes).toContain("Yes")
    expect(answerYes).toContain("UGX 1,350,000")

    const answerNo = answerAccountantQuery(
      "Can I spend UGX 1,800,000 today?",
      snap,
      "2026-11-05",
    )
    expect(answerNo).toContain("Not safely")
  })

  it("9. Tracks all 9 eligible personal income streams individually and blocks accidental duplicate entries", async () => {
    const { auth, repo } = createIsolatedHarness()
    const user = await auth.registerWithEmail({
      email: "streams@phenaxis.ug",
      password: "password123",
      displayName: "Streams Tester",
    })
    await repo.ensureUserInitialized(user.uid, user.displayName)

    const streams = [
      "employment_salary",
      "part_time_job",
      "freelance_earnings",
      "client_projects",
      "creative_technical_services",
      "ministry_allowances",
      "owner_withdrawal",
      "personal_gift",
      "other_income",
    ] as const

    for (const [idx, stream] of streams.entries()) {
      await repo.recordIncomeOrInflow(user.uid, {
        idempotencyKey: `stream_idem_${stream}`,
        title: `Stream ${idx + 1}: ${stream}`,
        description: `Testing ${stream}`,
        amount: 100_000,
        date: "2026-11-05",
        accountId: "acc_stanbic",
        incomeSourceId: "src_employment",
        incomeType: stream,
      })
    }

    // Accidental duplicate submission with a DIFFERENT idempotencyKey is rejected by fingerprint protection
    await expect(
      repo.recordIncomeOrInflow(user.uid, {
        idempotencyKey: "different_idem_key_same_payload",
        title: "Stream 1: employment_salary",
        description: "Duplicate click",
        amount: 100_000,
        date: "2026-11-05",
        accountId: "acc_stanbic",
        incomeSourceId: "src_employment",
        incomeType: "employment_salary",
      }),
    ).rejects.toThrow(/DUPLICATE_DETECTED/)

    const snap = await repo.getSnapshot(user.uid)
    const monthly = buildMonthlyIncomeSummary(snap, "2026-11")
    expect(monthly.totalEligiblePersonalIncome).toBe(900_000)
    expect(snap.allocations).toHaveLength(27) // 9 streams * 3 allocations each
    for (const stream of streams) {
      expect(monthly.byStream[stream]).toBe(100_000)
    }
  })
})
