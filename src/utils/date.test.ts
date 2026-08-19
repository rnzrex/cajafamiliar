import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidLocalDate, localDateString, localMonthString, parseLocalDate } from "./date";

afterEach(() => {
  vi.useRealTimers();
});

function setSystemTime(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe("localDateString", () => {
  it("usa America/Lima alrededor del cambio de día UTC (04:30Z es aún el día anterior en Lima)", () => {
    expect(localDateString(new Date("2026-08-20T04:30:00Z"))).toBe("2026-08-19");
  });

  it("usa America/Lima pasada la medianoche local (05:30Z ya es el nuevo día en Lima)", () => {
    expect(localDateString(new Date("2026-08-20T05:30:00Z"))).toBe("2026-08-20");
  });

  it("sin argumento usa el reloj actual del sistema", () => {
    setSystemTime("2026-08-20T04:30:00Z");
    expect(localDateString()).toBe("2026-08-19");
  });

  it("formatea con dígitos de dos posiciones", () => {
    setSystemTime("2026-01-05T05:30:00Z");
    expect(localDateString()).toBe("2026-01-05");
  });
});

describe("localMonthString", () => {
  it("devuelve YYYY-MM del mes local", () => {
    setSystemTime("2026-08-20T04:30:00Z");
    expect(localMonthString()).toBe("2026-08");
  });

  it("acepta una fecha explícita", () => {
    expect(localMonthString(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
  });

  it("cruza el año correctamente", () => {
    setSystemTime("2026-01-01T04:00:00Z");
    expect(localMonthString()).toBe("2025-12");
  });
});

describe("parseLocalDate", () => {
  it("parsea una fecha válida", () => {
    const date = parseLocalDate("2026-08-20");
    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe("2026-08-20T12:00:00.000Z");
  });

  it("rechaza fechas imposibles como 2026-02-30", () => {
    expect(parseLocalDate("2026-02-30")).toBeNull();
  });

  it("rechaza 2026-02-29 en año no bisiesto", () => {
    expect(parseLocalDate("2026-02-29")).toBeNull();
  });

  it("acepta 2028-02-29 en año bisiesto", () => {
    expect(parseLocalDate("2028-02-29")).not.toBeNull();
  });

  it("rechaza meses fuera de rango", () => {
    expect(parseLocalDate("2026-13-01")).toBeNull();
    expect(parseLocalDate("2026-00-10")).toBeNull();
  });

  it("rechaza días fuera de rango", () => {
    expect(parseLocalDate("2026-08-32")).toBeNull();
  });

  it("rechaza formatos inválidos", () => {
    expect(parseLocalDate("2026-8-1")).toBeNull();
    expect(parseLocalDate("2026/08/20")).toBeNull();
    expect(parseLocalDate("abc")).toBeNull();
    expect(parseLocalDate("")).toBeNull();
  });
});

describe("isValidLocalDate", () => {
  it("acepta fechas válidas", () => {
    expect(isValidLocalDate("2026-08-20")).toBe(true);
    expect(isValidLocalDate("2028-02-29")).toBe(true);
  });

  it("rechaza fechas imposibles", () => {
    expect(isValidLocalDate("2026-02-30")).toBe(false);
    expect(isValidLocalDate("2026-02-29")).toBe(false);
    expect(isValidLocalDate("2026-13-01")).toBe(false);
  });
});
