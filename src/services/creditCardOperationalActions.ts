import {
  recordCreditCardPurchase,
  recordCreditCardPayment,
  recordCreditCardFee,
  recordCreditCardCredit,
  reverseCreditCardEntry,
  closeCreditCardStatement,
  saveCreditCardProfile,
} from "./dataRepository";
import type {
  CreditCardPurchaseInput,
  CreditCardPurchaseResult,
  CreditCardPaymentInput,
  CreditCardPaymentResult,
  CreditCardFeeInput,
  CreditCardFeeResult,
  CreditCardCreditInput,
  CreditCardCreditResult,
  CreditCardReversalInput,
  CreditCardReversalResult,
  CreditCardStatementCloseInput,
  CreditCardStatementCloseResult,
  CreditCardProfileSaveInput,
  CreditCardProfileSaveResult,
} from "../types";

export type CreditCardOperationType =
  | "purchase"
  | "payment"
  | "fee"
  | "credit"
  | "reversal"
  | "statement_close"
  | "profile_save";

export interface CreditCardOperationDispatchParams {
  operation: CreditCardOperationType;
  purchaseInput?: CreditCardPurchaseInput;
  paymentInput?: CreditCardPaymentInput;
  feeInput?: CreditCardFeeInput;
  creditInput?: CreditCardCreditInput;
  reversalInput?: CreditCardReversalInput;
  statementCloseInput?: CreditCardStatementCloseInput;
  profileSaveInput?: CreditCardProfileSaveInput;
}

export type CreditCardOperationDispatchResult =
  | { type: "purchase"; result: CreditCardPurchaseResult }
  | { type: "payment"; result: CreditCardPaymentResult }
  | { type: "fee"; result: CreditCardFeeResult }
  | { type: "credit"; result: CreditCardCreditResult }
  | { type: "reversal"; result: CreditCardReversalResult }
  | { type: "statement_close"; result: CreditCardStatementCloseResult }
  | { type: "profile_save"; result: CreditCardProfileSaveResult };

export async function executeCreditCardOperation(
  params: CreditCardOperationDispatchParams
): Promise<CreditCardOperationDispatchResult> {
  switch (params.operation) {
    case "purchase":
      if (!params.purchaseInput) {
        throw new Error("Missing purchaseInput for credit card purchase operation");
      }
      return {
        type: "purchase",
        result: await recordCreditCardPurchase(params.purchaseInput),
      };

    case "payment":
      if (!params.paymentInput) {
        throw new Error("Missing paymentInput for credit card payment operation");
      }
      return {
        type: "payment",
        result: await recordCreditCardPayment(params.paymentInput),
      };

    case "fee":
      if (!params.feeInput) {
        throw new Error("Missing feeInput for credit card fee operation");
      }
      return {
        type: "fee",
        result: await recordCreditCardFee(params.feeInput),
      };

    case "credit":
      if (!params.creditInput) {
        throw new Error("Missing creditInput for credit card credit operation");
      }
      return {
        type: "credit",
        result: await recordCreditCardCredit(params.creditInput),
      };

    case "reversal":
      if (!params.reversalInput) {
        throw new Error("Missing reversalInput for credit card reversal operation");
      }
      return {
        type: "reversal",
        result: await reverseCreditCardEntry(params.reversalInput),
      };

    case "statement_close":
      if (!params.statementCloseInput) {
        throw new Error("Missing statementCloseInput for credit card statement close operation");
      }
      return {
        type: "statement_close",
        result: await closeCreditCardStatement(params.statementCloseInput),
      };

    case "profile_save":
      if (!params.profileSaveInput) {
        throw new Error("Missing profileSaveInput for credit card profile save operation");
      }
      return {
        type: "profile_save",
        result: await saveCreditCardProfile(params.profileSaveInput),
      };

    default:
      throw new Error(`Unsupported credit card operation type: ${(params as any).operation}`);
  }
}
