import { describe, expect, it } from "vitest";
import { assertHouseholdMembership, assertImportPathOwnership, responseError } from "./bankDocumentServer.js";

describe("bank document server authorization", () => {
  it("maps unauthenticated requests to 401", () => {
    expect(responseError(new Error("AUTH_REQUIRED"))).toEqual({ status: 401, body: { ok: false, error: "AUTH_REQUIRED" } });
  });

  it("rejects a household that the user cannot access", async () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const admin = {
      from: () => chain,
    } as any;
    await expect(assertHouseholdMembership(admin, "household-b", "user-a")).rejects.toThrow("HOUSEHOLD_ACCESS_DENIED");
    expect(responseError(new Error("HOUSEHOLD_ACCESS_DENIED")).status).toBe(403);
  });

  it("rejects paths owned by another household or user", () => {
    expect(() => assertImportPathOwnership(["household-b/user-b/import/file.pdf"], "household-a", "user-a", "import")).toThrow("DOCUMENT_PATH_ACCESS_DENIED");
    expect(responseError(new Error("DOCUMENT_PATH_ACCESS_DENIED")).status).toBe(403);
  });
});
