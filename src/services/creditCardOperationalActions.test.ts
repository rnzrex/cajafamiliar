import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeCreditCardOperation } from "./creditCardOperationalActions";
import * as dataRepository from "./dataRepository";

vi.mock("./dataRepository", () => ({
  recordCreditCardPurchase: vi.fn(),
  recordCreditCardPayment: vi.fn(),
  recordCreditCardFee: vi.fn(),
  recordCreditCardCredit: vi.fn(),
  reverseCreditCardEntry: vi.fn(),
  closeCreditCardStatement: vi.fn(),
  saveCreditCardProfile: vi.fn(),
}));

describe("executeCreditCardOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches purchase operation to recordCreditCardPurchase", async () => {
    const mockResult = { entryId: "e-1", movementId: "m-1" };
    vi.mocked(dataRepository.recordCreditCardPurchase).mockResolvedValue(mockResult as any);

    const input = {
      debtId: "d-1",
      entryDate: "2026-08-20",
      amount: 100,
      description: "Supermarket",
    } as any;

    const res = await executeCreditCardOperation({
      operation: "purchase",
      purchaseInput: input,
    });

    expect(res).toEqual({ type: "purchase", result: mockResult });
    expect(dataRepository.recordCreditCardPurchase).toHaveBeenCalledWith(input);
    expect(dataRepository.recordCreditCardPayment).not.toHaveBeenCalled();
    expect(dataRepository.recordCreditCardFee).not.toHaveBeenCalled();
    expect(dataRepository.recordCreditCardCredit).not.toHaveBeenCalled();
    expect(dataRepository.reverseCreditCardEntry).not.toHaveBeenCalled();
    expect(dataRepository.closeCreditCardStatement).not.toHaveBeenCalled();
    expect(dataRepository.saveCreditCardProfile).not.toHaveBeenCalled();
  });

  it("dispatches payment operation to recordCreditCardPayment", async () => {
    const mockResult = { entryId: "e-2", movementId: "m-2" };
    vi.mocked(dataRepository.recordCreditCardPayment).mockResolvedValue(mockResult as any);

    const input = {
      debtId: "d-1",
      entryDate: "2026-08-21",
      amount: 50,
      fromAccountId: "acc-1",
    } as any;

    const res = await executeCreditCardOperation({
      operation: "payment",
      paymentInput: input,
    });

    expect(res).toEqual({ type: "payment", result: mockResult });
    expect(dataRepository.recordCreditCardPayment).toHaveBeenCalledWith(input);
    expect(dataRepository.recordCreditCardPurchase).not.toHaveBeenCalled();
  });

  it("dispatches fee operation to recordCreditCardFee", async () => {
    const mockResult = { entryId: "e-3", movementId: null };
    vi.mocked(dataRepository.recordCreditCardFee).mockResolvedValue(mockResult as any);

    const input = {
      debtId: "d-1",
      entryDate: "2026-08-22",
      amount: 10,
      feeType: "annual_fee",
    } as any;

    const res = await executeCreditCardOperation({
      operation: "fee",
      feeInput: input,
    });

    expect(res).toEqual({ type: "fee", result: mockResult });
    expect(dataRepository.recordCreditCardFee).toHaveBeenCalledWith(input);
    expect(dataRepository.recordCreditCardPurchase).not.toHaveBeenCalled();
  });

  it("dispatches credit operation to recordCreditCardCredit", async () => {
    const mockResult = { entryId: "e-4", movementId: null };
    vi.mocked(dataRepository.recordCreditCardCredit).mockResolvedValue(mockResult as any);

    const input = {
      debtId: "d-1",
      entryDate: "2026-08-22",
      amount: 30,
      creditOfEntryId: "e-1",
    } as any;

    const res = await executeCreditCardOperation({
      operation: "credit",
      creditInput: input,
    });

    expect(res).toEqual({ type: "credit", result: mockResult });
    expect(dataRepository.recordCreditCardCredit).toHaveBeenCalledWith(input);
    expect(dataRepository.recordCreditCardPurchase).not.toHaveBeenCalled();
  });

  it("dispatches reversal operation to reverseCreditCardEntry", async () => {
    const mockResult = { reversalEntryId: "e-5" };
    vi.mocked(dataRepository.reverseCreditCardEntry).mockResolvedValue(mockResult as any);

    const input = {
      debtId: "d-1",
      targetEntryId: "e-1",
      reversalDate: "2026-08-23",
      reason: "Duplicate charge",
    } as any;

    const res = await executeCreditCardOperation({
      operation: "reversal",
      reversalInput: input,
    });

    expect(res).toEqual({ type: "reversal", result: mockResult });
    expect(dataRepository.reverseCreditCardEntry).toHaveBeenCalledWith(input);
    expect(dataRepository.recordCreditCardPurchase).not.toHaveBeenCalled();
  });

  it("dispatches statement_close operation to closeCreditCardStatement", async () => {
    const mockResult = { statementId: "stm-1" };
    vi.mocked(dataRepository.closeCreditCardStatement).mockResolvedValue(mockResult as any);

    const input = {
      debtId: "d-1",
      statementDate: "2026-08-20",
      dueDate: "2026-09-05",
      statementBalance: 500,
    } as any;

    const res = await executeCreditCardOperation({
      operation: "statement_close",
      statementCloseInput: input,
    });

    expect(res).toEqual({ type: "statement_close", result: mockResult });
    expect(dataRepository.closeCreditCardStatement).toHaveBeenCalledWith(input);
    expect(dataRepository.recordCreditCardPurchase).not.toHaveBeenCalled();
  });

  it("dispatches profile_save operation to saveCreditCardProfile", async () => {
    const mockResult = { debtId: "d-1" };
    vi.mocked(dataRepository.saveCreditCardProfile).mockResolvedValue(mockResult as any);

    const input = {
      debtId: "d-1",
      creditLimit: 12000,
      closingDay: 20,
      dueDay: 5,
      last4: "4321",
    } as any;

    const res = await executeCreditCardOperation({
      operation: "profile_save",
      profileSaveInput: input,
    });

    expect(res).toEqual({ type: "profile_save", result: mockResult });
    expect(dataRepository.saveCreditCardProfile).toHaveBeenCalledWith(input);
    expect(dataRepository.recordCreditCardPurchase).not.toHaveBeenCalled();
  });

  it("throws clear error when required input payload is missing", async () => {
    await expect(executeCreditCardOperation({ operation: "purchase" })).rejects.toThrow(
      "Missing purchaseInput for credit card purchase operation"
    );
    await expect(executeCreditCardOperation({ operation: "payment" })).rejects.toThrow(
      "Missing paymentInput for credit card payment operation"
    );
    await expect(executeCreditCardOperation({ operation: "fee" })).rejects.toThrow(
      "Missing feeInput for credit card fee operation"
    );
    await expect(executeCreditCardOperation({ operation: "credit" })).rejects.toThrow(
      "Missing creditInput for credit card credit operation"
    );
    await expect(executeCreditCardOperation({ operation: "reversal" })).rejects.toThrow(
      "Missing reversalInput for credit card reversal operation"
    );
    await expect(executeCreditCardOperation({ operation: "statement_close" })).rejects.toThrow(
      "Missing statementCloseInput for credit card statement close operation"
    );
    await expect(executeCreditCardOperation({ operation: "profile_save" })).rejects.toThrow(
      "Missing profileSaveInput for credit card profile save operation"
    );
  });

  it("throws error for unsupported operation type", async () => {
    await expect(executeCreditCardOperation({ operation: "unknown" as any })).rejects.toThrow(
      "Unsupported credit card operation type: unknown"
    );
  });
});
