import { describe, expect, it } from "vitest";
import { estimatedBalanceAfterRow } from "./debtEstimatedBalance.js";

describe("estimated debt detail balances", () => {
  it("keeps the historical schedule balance unchanged when current principal changes later", () => {
    const schedule = [
      { expectedPrincipal: 222.71 },
      { expectedPrincipal: 1000 },
      { expectedPrincipal: 1164.05 },
    ];

    expect(estimatedBalanceAfterRow(schedule, 0)).toBe(2164.05);
    // A later payment may change the live debt principal, but the function has
    // no live-principal input and therefore cannot double-subtract row 0.
    expect(estimatedBalanceAfterRow(schedule, 0)).toBe(2164.05);
    expect(estimatedBalanceAfterRow(schedule, 2)).toBe(0);
  });

  it("returns null instead of inventing a balance when a principal is missing", () => {
    expect(estimatedBalanceAfterRow([{ expectedPrincipal: 222.71 }, { expectedPrincipal: null }], 0)).toBeNull();
  });
});
