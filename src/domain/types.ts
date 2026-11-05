export const USER_COLLECTIONS = [
  "accounts",
  "transactions",
  "income_sources",
  "categories",
  "allocations",
  "budgets",
  "entrusted_funds",
  "savings_goals",
  "recurring_expenses",
  "tasks",
  "projects",
  "calendar_events",
  "financial_reports",
  "settings",
] as const

export type UserCollectionName = (typeof USER_COLLECTIONS)[number]

export type AccountType = "cash" | "bank" | "mobile_money" | "savings" | "business"

export interface Account {
  id: string
  ownerUid: string
  name: string
  type: AccountType
  institution: string
  currency: string
  color: "indigo" | "green" | "amber" | "violet" | "blue" | "emerald"
  icon: string
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Canonical Income & Inflow Types
 * Eligible personal income streams trigger the Automatic Giving Allocation Engine.
 * Business gross revenue and excluded non-income inflows NEVER trigger personal giving allocations.
 */
export type EligibleIncomeType =
  | "employment_salary"
  | "part_time_job"
  | "freelance_earnings"
  | "client_projects"
  | "creative_technical_services"
  | "ministry_allowances"
  | "owner_withdrawal"
  | "personal_gift"
  | "other_income"

export type BusinessInflowType = "business_gross_revenue"

export type NonIncomeInflowType =
  | "entrusted_inflow"
  | "loan_proceeds"
  | "transfer"
  | "reimbursement"
  | "refund"
  | "opening_balance"

export type IncomeClassification =
  | EligibleIncomeType
  | BusinessInflowType
  | NonIncomeInflowType

export const ELIGIBLE_INCOME_TYPES: readonly {
  value: EligibleIncomeType
  label: string
  description: string
}[] = [
  {
    value: "employment_salary",
    label: "Employment salary",
    description: "Regular full-time or contract employment pay",
  },
  {
    value: "part_time_job",
    label: "Part-time job",
    description: "Secondary or hourly part-time employment",
  },
  {
    value: "freelance_earnings",
    label: "Freelance earnings",
    description: "Independent freelance gigs and deliverables",
  },
  {
    value: "client_projects",
    label: "Client projects",
    description: "Direct personal earnings from client engagements",
  },
  {
    value: "creative_technical_services",
    label: "Creative & technical services",
    description: "Design, software engineering, media, consulting fees",
  },
  {
    value: "ministry_allowances",
    label: "Ministry allowances",
    description: "Honoraria, stipends, and ministry support",
  },
  {
    value: "owner_withdrawal",
    label: "Business owner withdrawal",
    description: "Personal draw taken from net business earnings",
  },
  {
    value: "personal_gift",
    label: "Personal gift",
    description: "Cash gifts and personal Monetary appreciation",
  },
  {
    value: "other_income",
    label: "Other personal income",
    description: "Miscellaneous eligible personal income",
  },
] as const

export const NON_ELIGIBLE_INFLOW_TYPES: readonly {
  value: BusinessInflowType | NonIncomeInflowType
  label: string
  reasonExcluded: string
}[] = [
  {
    value: "business_gross_revenue",
    label: "Business gross revenue",
    reasonExcluded: "Gross business receipts are not personal income until withdrawn",
  },
  {
    value: "entrusted_inflow",
    label: "Entrusted funds",
    reasonExcluded: "Custodial funds held on behalf of others",
  },
  {
    value: "loan_proceeds",
    label: "Loan proceeds",
    reasonExcluded: "Borrowed money is a liability, not personal income",
  },
  {
    value: "transfer",
    label: "Account transfer",
    reasonExcluded: "Internal movement between your own accounts",
  },
  {
    value: "reimbursement",
    label: "Expense reimbursement",
    reasonExcluded: "Repayment of money previously spent",
  },
  {
    value: "refund",
    label: "Purchase refund",
    reasonExcluded: "Return of previous expenditure",
  },
  {
    value: "opening_balance",
    label: "Opening balance",
    reasonExcluded: "Initial existing balance brought onto ledger",
  },
] as const

export interface IncomeSource {
  id: string
  ownerUid: string
  name: string
  defaultIncomeType: EligibleIncomeType | BusinessInflowType
  isBusinessSource: boolean
  description: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type CategoryKind = "personal_expense" | "business_cost" | "giving" | "income"

export interface Category {
  id: string
  ownerUid: string
  name: string
  kind: CategoryKind
  color: "indigo" | "amber" | "blue" | "pink" | "violet" | "green" | "emerald"
  icon: string
  createdAt: string
  updatedAt: string
}

export type TransactionKind =
  | "personal_income"
  | "business_revenue"
  | "project_cost"
  | "owner_withdrawal"
  | "owner_withdrawal_out"
  | "non_income_inflow"
  | "personal_expense"
  | "allocation_payment"
  | "transfer"
  | "savings_deposit"
  | "savings_withdrawal"
  | "entrusted_inflow"
  | "entrusted_outflow"

export type TransactionDirection = "in" | "out" | "earmark"
export type TransactionStatus = "active" | "corrected" | "voided"

export interface AuditEntry {
  timestamp: string
  action: "created" | "corrected" | "voided"
  actorUid: string
  reason: string
  previousAmount?: number
  newAmount?: number
  previousDescription?: string
  newDescription?: string
}

export interface LedgerTransaction {
  id: string
  ownerUid: string
  idempotencyKey: string
  fingerprint: string
  kind: TransactionKind
  direction: TransactionDirection
  status: TransactionStatus
  amount: number // Always >= 0 in UGX
  date: string // YYYY-MM-DD
  monthKey: string // YYYY-MM
  title: string
  description: string
  accountId: string | null // null only for pure custodial entrusted funds not tied to a personal account
  accountName: string
  // Income metadata
  incomeSourceId?: string | null
  incomeSourceName?: string | null
  incomeType?: IncomeClassification | null
  // Category / Expense metadata
  categoryId?: string | null
  categoryName?: string | null
  // Transfer / Linked account metadata
  transferGroupId?: string | null
  counterpartyAccountId?: string | null
  counterpartyAccountName?: string | null
  linkedTransactionId?: string | null
  // Giving Allocation link
  linkedAllocationId?: string | null
  allocationsGenerated?: boolean
  // Entrusted Fund link
  entrustedFundId?: string | null
  entrustedFundName?: string | null
  // Savings Goal link
  savingsGoalId?: string | null
  savingsGoalName?: string | null
  // Project / Recurring link
  projectId?: string | null
  recurringExpenseId?: string | null
  // Auditable history
  auditTrail: AuditEntry[]
  createdAt: string
  updatedAt: string
}

export type AllocationType = "tithe" | "thanksgiving" | "seed"
export type AllocationStatus = "unpaid" | "paid" | "voided"

export interface GivingAllocation {
  id: string
  ownerUid: string
  sourceTransactionId: string
  sourceTransactionTitle: string
  incomeSourceId: string
  incomeSourceName: string
  incomeType: EligibleIncomeType
  incomeDate: string // YYYY-MM-DD
  monthKey: string // YYYY-MM
  allocationType: AllocationType
  label: string
  percentage: number
  baseIncomeAmount: number
  amount: number // UGX integer
  status: AllocationStatus
  paidAt: string | null
  paidMonthKey: string | null
  paymentTransactionId: string | null
  paidFromAccountId: string | null
  paidFromAccountName: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Budget {
  id: string
  ownerUid: string
  categoryId: string
  categoryName: string
  monthKey: string // YYYY-MM or "default" for recurring monthly cap
  limitAmount: number
  color: "indigo" | "amber" | "blue" | "pink" | "violet" | "green"
  createdAt: string
  updatedAt: string
}

export interface EntrustedFund {
  id: string
  ownerUid: string
  name: string
  purpose: string
  stewardFor: string
  icon: string
  color: "violet" | "blue" | "amber" | "green" | "indigo"
  status: "active" | "closed"
  createdAt: string
  updatedAt: string
}

export interface SavingsGoal {
  id: string
  ownerUid: string
  name: string
  targetAmount: number
  targetDate: string
  linkedAccountId: string | null
  color: "indigo" | "green" | "blue" | "amber" | "violet"
  notes: string
  createdAt: string
  updatedAt: string
}

export interface RecurringExpense {
  id: string
  ownerUid: string
  name: string
  categoryId: string
  categoryName: string
  defaultAccountId: string
  amount: number
  dueDayOfMonth: number // 1-31
  frequency: "monthly" | "weekly" | "quarterly" | "annual"
  active: boolean
  lastPaidMonthKey: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskItem {
  id: string
  ownerUid: string
  title: string
  meta: string
  dueDate: string
  priority: "High" | "Medium" | "Low"
  done: boolean
  projectId: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectItem {
  id: string
  ownerUid: string
  name: string
  clientOrScope: string
  status: "active" | "planning" | "completed"
  budgetOrContractAmount: number
  dueDate: string
  incomeSourceId: string | null
  color: "indigo" | "blue" | "green" | "amber" | "violet"
  notes: string
  createdAt: string
  updatedAt: string
}

export interface CalendarEvent {
  id: string
  ownerUid: string
  title: string
  startTime: string // e.g., "09:00"
  durationLabel: string // e.g., "1 hour"
  date: string // YYYY-MM-DD
  scope: "Personal" | "Work" | "Finance" | "Church"
  color: "indigo" | "green" | "blue" | "amber" | "violet"
  createdAt: string
  updatedAt: string
}

export interface FinancialReportSnapshot {
  id: string
  ownerUid: string
  monthKey: string
  title: string
  eligiblePersonalIncome: number
  businessGrossRevenue: number
  projectCosts: number
  ownerWithdrawals: number
  personalExpenses: number
  givingAllocated: number
  givingPaid: number
  givingUnpaid: number
  actualPersonalBalance: number
  reservedObligations: number
  savingsBalances: number
  unallocatedAvailable: number
  entrustedBalances: number
  reconciled: boolean
  generatedAt: string
}

export interface UserSettings {
  id: "preferences"
  ownerUid: string
  displayName: string
  currency: string
  tithePercent: number
  thanksgivingPercent: number
  seedPercent: number
  updatedAt: string
}

export interface UserFinancialSnapshot {
  uid: string
  accounts: Account[]
  transactions: LedgerTransaction[]
  incomeSources: IncomeSource[]
  categories: Category[]
  allocations: GivingAllocation[]
  budgets: Budget[]
  entrustedFunds: EntrustedFund[]
  savingsGoals: SavingsGoal[]
  recurringExpenses: RecurringExpense[]
  tasks: TaskItem[]
  projects: ProjectItem[]
  calendarEvents: CalendarEvent[]
  financialReports: FinancialReportSnapshot[]
  settings: UserSettings
}

export interface DerivedBalances {
  // The 5 canonical balances required by PHENAXIS Financial Integrity
  actualAccountBalance: number
  reservedObligations: number
  unallocatedAvailableMoney: number
  savingsBalances: number
  entrustedBalances: number
  // Additional granular breakdowns
  businessRetainedBalance: number
  accountBalances: Record<string, number>
  savingsGoalBalances: Record<string, number>
  entrustedFundSummaries: Record<
    string,
    { received: number; spent: number; remaining: number }
  >
}

