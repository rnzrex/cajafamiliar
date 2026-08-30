export type MovementType = "ingreso" | "egreso";
export type MovementContext = "standard" | "debt_service" | "credit_card_purchase" | "credit_card_payment" | "credit_card_fee" | "credit_card_credit";
export type PaymentMethod = "efectivo" | "Yape" | "transferencia" | "tarjeta";
export type AccountReconciliationType = "cash" | "balance";
export type RecurringStatus = "pendiente" | "pagado";
export type RecurrenceType = "indefinite" | "fixed" | "one_time";
export type PaymentAmountMode = "fixed" | "variable";
export type CategoryType = MovementType | "ambos";
export type DebtKind = "bank_loan" | "family_loan" | "installment_purchase" | "mortgage" | "pledge" | "credit_card" | "other";
export type DebtStatus = "active" | "paid_off" | "refinanced";
export type DebtInstallmentAmountMode = "fixed" | "variable" | "unknown";
export type DebtPaymentFrequency = "monthly" | "biweekly" | "weekly" | "custom";
export type DebtEventType = "payment" | "principal_prepayment" | "principal_adjustment" | "refinance" | "payoff" | "reversal" | "installment_advance";
export type DebtScheduleReason = "initial" | "prepayment" | "rate_change" | "refinance" | "manual_adjustment" | "reversal";
export type DebtCollateralStatus = "pledged" | "released" | "forfeited";

export type BankLoanSubtype =
  | "personal"
  | "vehicular"
  | "mortgage"
  | "education"
  | "payroll"
  | "debt_consolidation"
  | "business"
  | "other";

export type AmortizationMethod =
  | "fixed_installment"
  | "constant_principal"
  | "increasing_installment"
  | "decreasing_installment"
  | "irregular_contract"
  | "custom"
  | "unknown";

export type DebtInsuranceType = "credit_life" | "vehicle" | "property" | "other";

export type DebtInsurancePricingMode =
  | "fixed_amount"
  | "percent_outstanding_balance"
  | "percent_original_principal"
  | "contract_schedule"
  | "unknown";
export type DebtInsuranceRateBasis =
  | "per_installment"
  | "total_credit_even"
  | "total_credit_upfront"
  | "total_credit_unknown";

export type ScheduleSource = "contractual" | "reconstructed" | "estimated" | "manual";
export type DebtScheduleState = "current" | "pending_bank_schedule" | "missing";

export type BankInterestDayCountBasis = "actual_days_360" | "actual_days_365";
export type BankDueDateAdjustmentRule = "none" | "sunday_to_monday" | "weekend_to_next_business_day" | "contractual_dates" | "unknown";
export type BankInstallmentTotalMode = "financial_installment_plus_costs" | "total_installment_including_costs" | "unknown";
export type BankReportedBalanceKind = "principal_balance" | "schedule_financial_balance" | "total_remaining_payments" | "unknown";

export type PrepaymentEffect =
  | "reduce_term"
  | "reduce_installment"
  | "pending_bank_schedule"
  | "other"
  | "unknown";

export interface BankLoanProfile {
  debtId: string;
  householdId: string;
  loanSubtype: BankLoanSubtype;
  contractNumber: string | null;
  amortizationMethod: AmortizationMethod;
  disbursedAmount: number | null;
  assetPrice: number | null;
  downPaymentAmount: number | null;
  financedAmount: number | null;
  termInstallments: number | null;
  installmentsPaidBeforeTracking?: number;
  interestDayCountBasis?: BankInterestDayCountBasis | null;
  dueDateAdjustmentRule?: BankDueDateAdjustmentRule | null;
  installmentTotalMode?: BankInstallmentTotalMode | null;
  reportedBalanceKind?: BankReportedBalanceKind | null;
  reportedBalanceAmount?: number | null;
  gracePeriodType: "none" | "total" | "partial";
  gracePeriodInstallments: number | null;
  balloonPaymentAmount: number | null;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DebtInsuranceTerms {
  id: string;
  debtId: string;
  householdId: string;
  insuranceType: DebtInsuranceType;
  label: string;
  pricingMode: DebtInsurancePricingMode;
  ratePercent: number | null;
  fixedAmount: number | null;
  rateBasis: string | null;
  isRequired: boolean;
  provider: string | null;
  policyReference: string | null;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdMember {
  householdId: string;
  userId: string;
  displayName: string;
  role: "owner" | "member";
}

export interface FinancialAccount {
  id: string;
  name: string;
  reconciliationType: AccountReconciliationType;
  openingBalance: number;
  currencyCode: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Movement {
  id: string;
  type: MovementType;
  date: string;
  amount: number;
  description: string;
  method: PaymentMethod;
  category: string;
  person: string;
  registeredByUserId?: string | null;
  accountId: string | null;
  movementContext: MovementContext;
  createdAt?: string;
  updatedAt?: string;
}

export type MovementFormInput = Omit<Movement, "id" | "person" | "registeredByUserId" | "movementContext"> & { person?: string };
export type MovementDraft = Partial<Omit<Movement, "id" | "movementContext">>;

export type DebtRepaymentStructure = "fixed_schedule" | "open_ended" | "unknown";
export type DebtInterestCalculationMode = "contract_schedule" | "contract_periodic_rate" | "tea_estimate" | "manual" | "unknown";
export type PeriodicRateBasis = "monthly" | "biweekly" | "weekly" | "daily";

/** Authority is intentionally separate from schedule provenance/reconciliation. */
export type DebtContractAuthority = "contractual" | "official_noncontractual" | "user_reported" | "estimated" | "unknown";
export type DebtPrincipalBasis = "asset_price_including_down_payment" | "financed_principal_only" | "reported_balance" | "unknown";
export type DebtInterestRateType = "nominal_annual_simple" | "effective_annual" | "effective_periodic" | "contract_schedule" | "manual" | "unknown";
export type DebtDayCountBasis = "actual_days_360" | "actual_days_365" | "unknown";
export type DebtFeeRuleType = "fixed" | "percentage" | "formula_known" | "contract_schedule_only" | "unknown";
export type DebtRefinancingStatus = "active" | "reversed";

export interface DebtFinancingContract {
  debtId: string;
  householdId: string;
  contractAuthority: DebtContractAuthority;
  principalBasis: DebtPrincipalBasis;
  assetPrice: number | null;
  downPaymentAmount: number | null;
  scheduledPrincipalAmount: number | null;
  financedPrincipalAmount: number | null;
  openingPrincipalAmount: number | null;
  repaymentStructure: DebtRepaymentStructure;
  amortizationMethod: AmortizationMethod;
  installmentAmountMode: DebtInstallmentAmountMode;
  paymentFrequency: DebtPaymentFrequency | null;
  customFrequencyDays: number | null;
  firstDueDate: string | null;
  interestRateType: DebtInterestRateType;
  interestRatePercent: number | null;
  interestRateBasis: string | null;
  dayCountBasis: DebtDayCountBasis;
  feeRuleType: DebtFeeRuleType;
  feeRule: Record<string, unknown>;
  prepaymentTerms: Record<string, unknown>;
  authorityNotes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DebtRefinancingLink {
  id: string;
  householdId: string;
  sourceDebtId: string;
  targetDebtId: string;
  sourceRefinanceEventId: string;
  effectiveDate: string;
  settledPrincipalAmount: number;
  amountPaidByNewCreditor: number;
  cashContributionAmount: number;
  targetFinancedPrincipalAmount: number;
  contributionMovementId: string | null;
  refinanceCostsAmount: number;
  refinanceCostsMovementId: string | null;
  status: DebtRefinancingStatus;
  reversalEventId: string | null;
  notes: string;
  createdByUserId: string;
  createdAt: string;
}

export interface DebtStateSnapshot {
  currentPrincipal: number;
  principalPaid: number;
  cashPaid: number;
  interestPaid: number;
  feesPaid: number;
  insurancePaid: number;
  otherCostsPaid: number;
  effectiveEventCount: number;
  futureInstallmentCount: number;
  scheduleKnown: boolean;
  scheduleAuthority: DebtContractAuthority;
  nextDueDate: string | null;
  nextInstallmentAmount: number | null;
  remainingScheduledPrincipal: number | null;
  remainingProjectedInterest: number | null;
  remainingProjectedFees: number | null;
  remainingProjectedInsurance: number | null;
  remainingProjectedTotalCash: number | null;
  paidInstallmentCount: number;
  partialInstallmentCount: number;
  advancedInstallmentCount: number;
  pendingInstallmentCount: number;
  overdueInstallmentCount: number;
  certainty: "exact" | "reported" | "estimated" | "insufficient_info";
}

export interface Debt {
  id: string;
  name: string;
  creditorName: string;
  debtKind: DebtKind;
  currencyCode: string;
  originDate: string | null;
  trackingStartDate: string;
  originalPrincipal: number | null;
  openingPrincipalBalance: number;
  plannedInstallmentCount: number | null;
  plannedInstallmentAmount: number | null;
  installmentAmountMode: DebtInstallmentAmountMode;
  paymentFrequency: DebtPaymentFrequency | null;
  customFrequencyDays: number | null;
  firstDueDate: string | null;
  teaPercent: number | null;
  tceaPercent: number | null;
  notes: string;
  status: DebtStatus;
  isArchived: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  repaymentStructure?: DebtRepaymentStructure;
  interestCalculationMode?: DebtInterestCalculationMode;
  periodicRatePercent?: number | null;
  periodicRateBasis?: PeriodicRateBasis | null;
  interestAccrualAnchorDate?: string | null;
  minimumPrincipalPayment?: number | null;
}

export interface DebtEvent {
  id: string;
  debtId: string;
  eventDate: string;
  eventType: DebtEventType;
  cashAmount: number;
  principalDelta: number;
  interestPaid: number;
  feesPaid: number;
  insurancePaid: number;
  otherCostPaid: number;
  extraPrincipalAmount?: number;
  prepaymentEffect?: PrepaymentEffect | null;
  breakdownComplete: boolean;
  movementId: string | null;
  reversalOfEventId: string | null;
  description: string;
  registeredByUserId: string;
  createdAt: string;
}

export interface DebtScheduleVersion {
  id: string;
  debtId: string;
  versionNumber: number;
  effectiveDate: string;
  reason: DebtScheduleReason;
  scheduleSource?: ScheduleSource;
  authority?: DebtContractAuthority;
  isAuthoritative?: boolean;
  triggerEventId: string | null;
  notes: string;
  createdByUserId: string;
  createdAt: string;
}

export interface DebtInstallment {
  id: string;
  scheduleVersionId: string;
  debtId: string;
  installmentNumber: number;
  dueDate: string;
  expectedAmount: number | null;
  expectedPrincipal: number | null;
  expectedInterest: number | null;
  expectedFees: number | null;
  expectedInsurance: number | null;
  expectedTaxes?: number | null;
  rowRole?: "down_payment" | "installment" | "summary" | "unknown";
  phase?: string | null;
  evidence?: Record<string, unknown>;
  reportedBalance?: number | null;
  contractualInstallmentNumber?: number | null;
  isPaidBeforeTracking?: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface DebtEventInstallmentAllocation {
  id: string;
  eventId: string;
  installmentId: string;
  debtId: string;
  allocatedAmount: number;
  createdByUserId: string;
  createdAt: string;
}

export interface DebtInstallmentCarriedAllocation {
  id: string;
  restoredInstallmentId: string;
  sourceEventId: string;
  sourceAllocationId: string;
  debtId: string;
  householdId: string;
  allocatedAmount: number;
  createdByUserId: string;
  createdAt: string;
}

export interface DebtCollateral {
  id: string;
  debtId: string;
  description: string;
  pledgedValue: number | null;
  estimatedValue: number | null;
  redemptionDeadline: string | null;
  status: DebtCollateralStatus;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCardProfile {
  debtId: string;
  creditLimit: number | null;
  closingDay: number | null;
  dueDay: number | null;
  last4: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type CreditCardEntryType = "purchase" | "payment" | "finance_charge" | "credit" | "reversal";

export interface CreditCardEntry {
  id: string;
  debtId: string;
  entryDate: string;
  entryType: CreditCardEntryType;
  liabilityDelta: number;
  movementId: string | null;
  creditOfEntryId?: string | null;
  reversalOfEntryId: string | null;
  description: string;
  registeredByUserId: string;
  createdAt: string;
}

export interface CreditCardStatement {
  id: string;
  debtId: string;
  statementDate: string;
  dueDate: string;
  statementBalance: number;
  minimumPaymentAmount: number | null;
  closingEntryId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCardPurchaseInput {
  debtId: string;
  entryId: string;
  movementId: string;
  purchaseDate: string;
  amount: number;
  description: string;
  category: string;
}

export interface CreditCardPurchaseResult {
  success: boolean;
  entryId: string;
  movementId: string;
  idempotent: boolean;
}

export interface CreditCardPaymentInput {
  debtId: string;
  entryId: string;
  movementId: string;
  paymentDate: string;
  amount: number;
  accountId: string;
  description: string;
  category: string;
}

export interface CreditCardPaymentResult {
  success: boolean;
  entryId: string;
  movementId: string;
  idempotent: boolean;
}

export interface CreditCardStatementCloseInput {
  statementId: string;
  debtId: string;
  statementDate: string;
  dueDate: string;
  minimumPaymentAmount?: number | null;
}

export interface CreditCardStatementCloseResult {
  success: boolean;
  statementId: string;
  statementBalance: number;
  minimumPaymentAmount: number | null;
  idempotent: boolean;
}

export type ReconciliationStatus = "matched" | "mismatch";

export interface AccountReconciliation {
  id: string;
  householdId: string;
  accountId: string;
  reconciliationType: AccountReconciliationType;
  currencyCode: string;
  openingBalanceSnapshot: number;
  expectedBalance: number;
  actualBalance: number;
  difference: number;
  status: ReconciliationStatus;
  denominations: Record<string, number> | Array<{ denomination: number; count: number }> | null;
  registeredByUserId: string;
  createdAt: string;
}

export interface AccountReconciliationMovement {
  id: string;
  householdId: string;
  reconciliationId: string;
  movementId: string;
  balanceContribution: number;
  movementUpdatedAtSnapshot: string;
  movementSnapshot: Record<string, any>;
  createdAt: string;
}

export interface RecordAccountReconciliationInput {
  reconciliationId: string;
  accountId: string;
  actualBalance?: number | null;
  denominations?: Record<string, number> | Array<{ denomination: number; count: number }> | null;
}

export interface RecordAccountReconciliationResult {
  success: boolean;
  reconciliationId: string;
  status: ReconciliationStatus;
  openingBalanceSnapshot: number;
  expectedBalance: number;
  actualBalance: number;
  difference: number;
  movementsCount: number;
  idempotent: boolean;
}

export interface CreditCardFeeInput {
  debtId: string;
  entryId: string;
  movementId: string;
  feeDate: string;
  amount: number;
  description: string;
  category: string;
}

export interface CreditCardFeeResult {
  success: boolean;
  entryId: string;
  movementId: string;
  idempotent: boolean;
}

export interface CreditCardCreditInput {
  debtId: string;
  entryId: string;
  movementId: string;
  targetEntryId: string;
  creditDate: string;
  amount: number;
  description: string;
}

export interface CreditCardCreditResult {
  success: boolean;
  entryId: string;
  movementId: string;
  idempotent: boolean;
}

export interface CreditCardReversalInput {
  debtId: string;
  reversalEntryId: string;
  targetEntryId: string;
  reversalDate: string;
  description: string;
}

export interface CreditCardReversalResult {
  success: boolean;
  entryId: string;
  reversalOfEntryId: string;
  idempotent: boolean;
}

export interface CreditCardDebtCreateInput {
  debtId: string;
  name: string;
  creditorName: string;
  currencyCode: string;
  originDate?: string | null;
  trackingStartDate: string;
  openingBalance: number;
  creditLimit?: number | null;
  closingDay?: number | null;
  dueDay?: number | null;
  last4?: string | null;
  teaPercent?: number | null;
  tceaPercent?: number | null;
  notes?: string | null;
}

export interface DebtCollateralInput {
  description: string;
  pledgedValue?: number | null;
  estimatedValue?: number | null;
  redemptionDeadline?: string | null;
}

export interface DebtCreateInput {
  debtId: string;
  name: string;
  creditorName: string;
  debtKind: DebtKind;
  currencyCode: string;
  originDate?: string | null;
  trackingStartDate: string;
  originalPrincipal?: number | null;
  openingPrincipalBalance: number;
  plannedInstallmentCount?: number | null;
  plannedInstallmentAmount?: number | null;
  installmentAmountMode: DebtInstallmentAmountMode;
  paymentFrequency?: DebtPaymentFrequency | null;
  customFrequencyDays?: number | null;
  firstDueDate?: string | null;
  teaPercent?: number | null;
  tceaPercent?: number | null;
  notes?: string | null;
  installments: DebtScheduleInstallmentInput[];
  collaterals: DebtCollateralInput[];
  repaymentStructure?: DebtRepaymentStructure;
  interestCalculationMode?: DebtInterestCalculationMode;
  periodicRatePercent?: number | null;
  periodicRateBasis?: PeriodicRateBasis | null;
  minimumPrincipalPayment?: number | null;
}

export interface DebtFinancingContractSaveInput {
  debtId: string;
  contract: Partial<Omit<DebtFinancingContract, "debtId" | "householdId" | "createdByUserId" | "createdAt" | "updatedAt">>;
}

export interface DebtDocumentImportJobInput {
  debtId?: string | null;
  documentKind: "contract" | "schedule" | "refinance" | "statement" | "other";
  documentAuthority: DebtContractAuthority;
  provider?: string | null;
  model?: string | null;
  fileCount: number;
  storagePaths?: string[];
  normalizedMetadata?: Record<string, unknown>;
}

export interface DebtRefinanceInput {
  linkId: string;
  sourceDebtId: string;
  sourceRefinanceEventId: string;
  targetDebtId: string;
  effectiveDate: string;
  targetName: string;
  targetCreditorName: string;
  targetDebtKind: DebtKind;
  currencyCode: string;
  targetOriginalPrincipal?: number | null;
  targetOpeningPrincipal: number;
  targetPlannedInstallmentCount?: number | null;
  targetPlannedInstallmentAmount?: number | null;
  targetInstallmentAmountMode: DebtInstallmentAmountMode;
  targetPaymentFrequency?: DebtPaymentFrequency | null;
  targetCustomFrequencyDays?: number | null;
  targetFirstDueDate?: string | null;
  targetTeaPercent?: number | null;
  targetTceaPercent?: number | null;
  targetNotes?: string | null;
  amountPaidByNewCreditor: number;
  cashContributionAmount: number;
  targetFinancedPrincipalAmount: number;
  targetInstallments?: DebtScheduleInstallmentInput[];
  targetScheduleSource?: ScheduleSource | null;
  targetContract?: Record<string, unknown> | null;
  contributionMovementId?: string | null;
  contributionAccountId?: string | null;
  contributionDescription?: string | null;
  contributionCategory?: string | null;
  refinanceCostsAmount: number;
  refinanceCostsMovementId?: string | null;
  refinanceCostsAccountId?: string | null;
  refinanceCostsDescription?: string | null;
  refinanceCostsCategory?: string | null;
  notes?: string | null;
}

export interface CreditCardDebtCreateResult {
  success: boolean;
  debtId: string;
  debt: Debt;
  profile: CreditCardProfile;
}

export interface CreditCardProfileSaveInput {
  debtId: string;
  creditLimit?: number | null;
  closingDay?: number | null;
  dueDay?: number | null;
  last4?: string | null;
}

export interface CreditCardProfileSaveResult {
  success: boolean;
  profile: CreditCardProfile;
}

export interface DebtScheduleInstallmentInput {
  installmentNumber: number;
  contractualInstallmentNumber?: number | null;
  isPaidBeforeTracking?: boolean;
  dueDate: string;
  expectedAmount?: number | null;
  expectedPrincipal?: number | null;
  expectedInterest?: number | null;
  expectedFees?: number | null;
  expectedInsurance?: number | null;
  expectedTaxes?: number | null;
  reportedBalance?: number | null;
  rowRole?: "down_payment" | "installment" | "summary" | "unknown";
  phase?: string | null;
  evidence?: Record<string, unknown>;
}

export interface DebtAllocationInput {
  installmentId: string;
  allocatedAmount: number;
}

export interface DebtPaymentInput {
  debtId: string;
  eventId: string;
  movementId: string;
  eventDate: string;
  cashAmount: number;
  accountId: string;
  description: string;
  category: string;
  principalAmount: number;
  interestPaid: number;
  feesPaid: number;
  insurancePaid: number;
  otherCostPaid: number;
  extraPrincipalAmount?: number | null;
  prepaymentEffect?: PrepaymentEffect | null;
  breakdownComplete: boolean;
  allocations: DebtAllocationInput[];
  scheduleInstallments?: DebtScheduleInstallmentInput[];
  scheduleNotes?: string | null;
  scheduleSource?: Exclude<ScheduleSource, "manual"> | null;
}

export interface DebtPrepaymentInput {
  debtId: string;
  eventId: string;
  movementId: string;
  eventDate: string;
  cashAmount: number;
  accountId: string;
  description: string;
  category: string;
  principalAmount: number;
  interestPaid: number;
  feesPaid: number;
  insurancePaid: number;
  otherCostPaid: number;
  prepaymentEffect?: PrepaymentEffect | null;
  breakdownComplete: boolean;
  scheduleInstallments: DebtScheduleInstallmentInput[];
  scheduleNotes?: string | null;
  scheduleSource?: ScheduleSource | null;
}

export interface DebtInstallmentAdvanceInput {
  debtId: string;
  eventId: string;
  movementId: string;
  eventDate: string;
  cashAmount: number;
  accountId: string;
  description: string;
  category: string;
  principalAmount: number;
  interestPaid: number;
  feesPaid: number;
  insurancePaid: number;
  otherCostPaid: number;
  breakdownComplete: boolean;
  allocations: DebtAllocationInput[];
}

export interface DebtPayoffInput {
  debtId: string;
  eventId: string;
  movementId: string;
  eventDate: string;
  cashAmount: number;
  accountId: string;
  description: string;
  category: string;
  interestPaid: number;
  feesPaid: number;
  insurancePaid: number;
  otherCostPaid: number;
  breakdownComplete: boolean;
}

export interface DebtReversalInput {
  debtId: string;
  reversalEventId: string;
  targetEventId: string;
  eventDate: string;
  description: string;
  scheduleInstallments: DebtScheduleInstallmentInput[];
  scheduleNotes?: string | null;
}

export interface CashCount {
  id: string;
  createdAt: string;
  denominations: Record<string, number>;
  total: number;
  expected: number;
  difference: number;
  accountId: string | null;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color?: string;
  icon?: string;
  is_active: boolean;
  created_at: string;
}

export interface RecurringPayment {
  id: string;
  name: string;
  amount: number | null;
  amount_mode: PaymentAmountMode;
  dueDay: number | null;
  dueDate: string | null;
  category: string;
  status: RecurringStatus;
  notes: string;
  recurrence_type: RecurrenceType;
  total_installments: number | null;
  paid_installments: number;
  is_active: boolean;
  last_paid_month: number | null;
  last_paid_year: number | null;
  paidAt?: string | null;
  linked_debt_id?: string | null;
  linkedDebtId?: string | null;
  starts_on?: string | null;
  startsOn?: string | null;
  currency_code?: string;
  currencyCode?: string;
}

export interface AppData {
  movements: Movement[];
  cashCounts: CashCount[];
  recurringPayments: RecurringPayment[];
  categories: Category[];
  initialBalance: number;
  financialAccounts: FinancialAccount[];
  debts: Debt[];
  bankLoanProfiles?: BankLoanProfile[];
  debtFinancingContracts?: DebtFinancingContract[];
  debtRefinancingLinks?: DebtRefinancingLink[];
  debtInsuranceTerms?: DebtInsuranceTerms[];
  debtEvents: DebtEvent[];
  debtScheduleVersions: DebtScheduleVersion[];
  debtInstallments: DebtInstallment[];
  debtEventInstallmentAllocations: DebtEventInstallmentAllocation[];
  debtInstallmentCarriedAllocations?: DebtInstallmentCarriedAllocation[];
  debtCollaterals: DebtCollateral[];
  creditCardProfiles: CreditCardProfile[];
  creditCardEntries: CreditCardEntry[];
  creditCardStatements: CreditCardStatement[];
  accountReconciliations: AccountReconciliation[];
  accountReconciliationMovements: AccountReconciliationMovement[];
  movementCorrections: MovementCorrection[];
}

export interface MovementCorrection {
  id: string;
  householdId: string;
  movementId: string;
  correctionId: string;
  requestSnapshot?: Record<string, any>;
  beforeSnapshot: Record<string, any>;
  afterSnapshot: Record<string, any>;
  reason: string;
  registeredByUserId: string;
  createdAt: string;
}

export const baseCategories: Category[] = [
  { id: "cat-comida-cenas", name: "Comida / cenas", type: "egreso", color: "#ef4444", icon: "utensils", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-mercado", name: "Mercado", type: "egreso", color: "#22c55e", icon: "shopping-basket", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-luz", name: "Luz", type: "egreso", color: "#f59e0b", icon: "lightbulb", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-agua", name: "Agua", type: "egreso", color: "#0ea5e9", icon: "droplet", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-telefono", name: "Teléfono", type: "egreso", color: "#6366f1", icon: "phone", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-internet", name: "Internet", type: "egreso", color: "#2563eb", icon: "wifi", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-prestamos", name: "Préstamos", type: "egreso", color: "#7c3aed", icon: "landmark", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-transporte", name: "Transporte", type: "egreso", color: "#f97316", icon: "car", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-salud", name: "Salud", type: "egreso", color: "#14b8a6", icon: "heart-pulse", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-ocio", name: "Ocio", type: "egreso", color: "#db2777", icon: "party-popper", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-cigarrillos", name: "Cigarrillos", type: "egreso", color: "#64748b", icon: "circle", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-compras-personales", name: "Compras personales", type: "egreso", color: "#a855f7", icon: "shopping-bag", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-casa", name: "Casa", type: "egreso", color: "#0891b2", icon: "home", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-negocio", name: "Negocio", type: "ambos", color: "#16a34a", icon: "briefcase", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-otros", name: "Otros", type: "ambos", color: "#94a3b8", icon: "more-horizontal", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
];

export const paymentMethods: PaymentMethod[] = ["efectivo", "Yape", "transferencia", "tarjeta"];
