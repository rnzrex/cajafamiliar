import { describe, expect, it } from "vitest";
import { parseContractualScheduleText } from "./debtScheduleParser.js";

describe("bank schedule optional reported balance", () => {
  it("preserves a reported bank balance without changing contractual components", () => {
    const result = parseContractualScheduleText("Cuota\tFecha\tTotal\tCapital\tInterés\tSeguro\tGastos\tSaldo\n1\t2026-06-10\t347.67\t140.58\t194.41\t12.68\t0\t3961.09");
    expect(result.valid).toBe(true);
    expect(result.rows[0].reportedBalance).toBe(3961.09);
    expect(result.rows[0].expectedAmount).toBe(347.67);
  });
});
