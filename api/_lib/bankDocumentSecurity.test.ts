import { describe, expect, it } from "vitest";
import { isAllowedBankDocument, isOwnedBankDocumentPath, parseJsonBody, readBearerToken, safeStorageFileName } from "./bankDocumentSecurity.js";

describe("bank document security boundaries", () => {
  it("accepts only allow-listed extensions, MIME and size", () => {
    expect(isAllowedBankDocument("cronograma.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 100)).toBe(true);
    expect(isAllowedBankDocument("secret.exe", "application/octet-stream", 100)).toBe(false);
    expect(isAllowedBankDocument("foto.png", "image/png", 21 * 1024 * 1024)).toBe(false);
  });

  it("requires exact private ownership path and rejects traversal/public URLs", () => {
    expect(isOwnedBankDocumentPath("h1/u1/i1/contrato-abc.pdf", "h1", "u1", "i1")).toBe(true);
    expect(isOwnedBankDocumentPath("h1/u2/i1/contrato.pdf", "h1", "u1", "i1")).toBe(false);
    expect(isOwnedBankDocumentPath("https://example.com/contrato.pdf", "h1", "u1", "i1")).toBe(false);
    expect(safeStorageFileName("../../DNI persona.pdf", "0-ab12")).toBe("document-0-ab12.pdf");
    expect(safeStorageFileName("Credito-Juan-DNI-123.pdf", "opaque")).not.toContain("Credito");
  });

  it("parses bearer auth without exposing arbitrary headers", () => {
    expect(readBearerToken({ authorization: "Bearer session-token" })).toBe("session-token");
    expect(readBearerToken({ authorization: "Basic secret" })).toBeNull();
    expect(parseJsonBody('{"householdId":"h1"}')).toEqual({ householdId: "h1" });
    expect(parseJsonBody("not-json")).toBeNull();
  });
});
