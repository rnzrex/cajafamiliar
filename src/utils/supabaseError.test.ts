import { describe, expect, it } from "vitest";
import { getSafeSupabaseErrorMessage, normalizeSupabaseError, toSafeSupabaseError } from "./supabaseError";

describe("Supabase/PostgREST error normalization", () => {
  it("maps stable application errors without exposing the database payload", () => {
    const result = normalizeSupabaseError({
      code: "P0001",
      message: "ERROR: INVALID_INSTALLMENTS for household 11111111-1111-1111-1111-111111111111",
      details: "raw SQL payload",
      hint: "secret-token-value",
    });

    expect(result.message).toBe("Revisa las filas del cronograma: fechas, números y montos deben ser válidos.");
    expect(result.message).not.toContain("11111111");
    expect(result.message).not.toContain("raw SQL");
    expect(result.message).not.toContain("secret-token");
  });

  it("returns a generic safe message for an unknown database failure and only a safe reference code", () => {
    const result = normalizeSupabaseError({
      code: "42883",
      message: "type pg_catalog.integer does not exist for household 22222222-2222-2222-2222-222222222222",
      details: "select private.secret from credentials",
      hint: "use token abc123",
    });

    expect(result.message).toBe("No se pudo completar la operación en Caja Familiar. Código de referencia: 42883.");
    expect(result.message).not.toContain("pg_catalog");
    expect(result.message).not.toContain("22222222");
    expect(result.message).not.toContain("credentials");
    expect(result.message).not.toContain("abc123");
  });

  it("converts plain Supabase errors to an Error safe for the UI", () => {
    const error = toSafeSupabaseError({ code: "HOUSEHOLD_ACCESS_DENIED", message: "private row details" });

    expect(error).toBeInstanceOf(Error);
    expect(getSafeSupabaseErrorMessage(error)).toBe("No tienes acceso al hogar seleccionado.");
  });

  it("does not preserve arbitrary Error messages that could contain SQL or identifiers", () => {
    const message = getSafeSupabaseErrorMessage(new Error("SQL token=secret household=00000000-0000-4000-8000-000000002502"));

    expect(message).toBe("No se pudo completar la operación en Caja Familiar.");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("00000000-0000-4000-8000-000000002502");
  });
});
