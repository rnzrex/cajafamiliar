import { describe, expect, it } from "vitest";
import type { Movement } from "../types";
import { defaultMovementFilters, filterMovements, movementTotals } from "./movementFilters";
import type { MovementFilters } from "./movementFilters";

function movement(overrides: Partial<Movement>): Movement {
  return {
    id: "m1",
    type: "egreso",
    date: "2026-08-15",
    amount: 0,
    description: "movimiento",
    method: "efectivo",
    category: "Otros",
    person: "Renzo",
    accountId: null,
    ...overrides,
  };
}

function filters(overrides: Partial<MovementFilters>): MovementFilters {
  return { ...defaultMovementFilters(), ...overrides };
}

const accountYape = "acc-yape";
const accountCash = "acc-cash";

const movements = [
  movement({ id: "a", type: "ingreso", date: "2026-08-20", amount: 500, description: "Ingreso negocio", method: "Yape", category: "Negocio", person: "Renzo", accountId: accountYape }),
  movement({ id: "b", type: "egreso", date: "2026-08-15", amount: 80, description: "Compra Mercado", method: "efectivo", category: "Mercado", person: "Papa", accountId: accountCash }),
  movement({ id: "c", type: "egreso", date: "2026-08-10", amount: 45, description: "Pago Teléfono", method: "Yape", category: "Teléfono", person: "Mama", accountId: accountYape }),
  movement({ id: "d", type: "egreso", date: "2026-07-30", amount: 120, description: "Gasolina", method: "tarjeta", category: "Transporte", person: "Renzo", accountId: null }),
  movement({ id: "e", type: "ingreso", date: "2026-07-15", amount: 300, description: "Venta", method: "transferencia", category: "Negocio", person: "Verónica", accountId: accountYape }),
];

describe("filterMovements — fecha", () => {
  it("todos devuelve todos los movimientos ordenados por fecha descendente", () => {
    const result = filterMovements(movements, filters({ dateMode: "all" }));
    expect(result.map((item) => item.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("mes filtra por el mes seleccionado", () => {
    const result = filterMovements(movements, filters({ dateMode: "month", month: "2026-08" }));
    expect(result.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("fecha exacta", () => {
    const result = filterMovements(movements, filters({ dateMode: "date", exactDate: "2026-08-15" }));
    expect(result.map((item) => item.id)).toEqual(["b"]);
  });

  it("rango inclusivo por ambos extremos", () => {
    const result = filterMovements(movements, filters({ dateMode: "range", dateFrom: "2026-08-10", dateTo: "2026-08-20" }));
    expect(result.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("rango solo con inicio incluye todo desde esa fecha", () => {
    const result = filterMovements(movements, filters({ dateMode: "range", dateFrom: "2026-08-10", dateTo: "" }));
    expect(result.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("rango solo con fin incluye todo hasta esa fecha", () => {
    const result = filterMovements(movements, filters({ dateMode: "range", dateFrom: "", dateTo: "2026-07-20" }));
    expect(result.map((item) => item.id)).toEqual(["e"]);
  });
});

describe("filterMovements — categoría, cuenta y tipo", () => {
  it("categoría", () => {
    const result = filterMovements(movements, filters({ category: "Mercado" }));
    expect(result.map((item) => item.id)).toEqual(["b"]);
  });

  it("categoría 'todas' no filtra", () => {
    expect(filterMovements(movements, filters({ category: "todas" })).length).toBe(5);
  });

  it("cuenta", () => {
    expect(filterMovements(movements, filters({ accountId: accountYape })).map((item) => item.id)).toEqual(["a", "c", "e"]);
    expect(filterMovements(movements, filters({ accountId: accountCash })).map((item) => item.id)).toEqual(["b"]);
  });

  it("cuenta 'sin asignar' filtra movimientos históricos", () => {
    expect(filterMovements(movements, filters({ accountId: "__unassigned__" })).map((item) => item.id)).toEqual(["d"]);
  });

  it("cuenta vacía no filtra", () => {
    expect(filterMovements(movements, filters({ accountId: "" })).length).toBe(5);
  });

  it("tipo ingreso", () => {
    const result = filterMovements(movements, filters({ type: "ingreso" }));
    expect(result.map((item) => item.id)).toEqual(["a", "e"]);
  });

  it("tipo egreso", () => {
    const result = filterMovements(movements, filters({ type: "egreso" }));
    expect(result.map((item) => item.id)).toEqual(["b", "c", "d"]);
  });
});

describe("filterMovements — búsqueda", () => {
  it("no distingue mayúsculas en la descripción", () => {
    const result = filterMovements(movements, filters({ search: "MERCADO" }));
    expect(result.map((item) => item.id)).toEqual(["b"]);
  });

  it("no distingue acentos en la categoría", () => {
    const result = filterMovements(movements, filters({ search: "telefono" }));
    expect(result.map((item) => item.id)).toEqual(["c"]);
  });

  it("busca en la persona", () => {
    const result = filterMovements(movements, filters({ search: "papa" }));
    expect(result.map((item) => item.id)).toEqual(["b"]);
  });

  it("busca en la categoría", () => {
    const result = filterMovements(movements, filters({ search: "transporte" }));
    expect(result.map((item) => item.id)).toEqual(["d"]);
  });

  it("normaliza espacios múltiples", () => {
    const result = filterMovements(movements, filters({ search: "  compra   mercado  " }));
    expect(result.map((item) => item.id)).toEqual(["b"]);
  });

  it("sin coincidencias devuelve vacío", () => {
    expect(filterMovements(movements, filters({ search: "inexistente" }))).toEqual([]);
  });
});

describe("filterMovements — combinación", () => {
  it("combina mes, tipo y cuenta", () => {
    const result = filterMovements(movements, filters({ dateMode: "month", month: "2026-08", type: "egreso", accountId: accountYape }));
    expect(result.map((item) => item.id)).toEqual(["c"]);
  });
});

describe("movementTotals", () => {
  it("suma ingresos, egresos y saldo", () => {
    const totals = movementTotals(movements);
    expect(totals.income).toBe(800);
    expect(totals.expense).toBe(245);
    expect(totals.balance).toBe(555);
  });

  it("devuelve ceros sin movimientos", () => {
    expect(movementTotals([])).toEqual({ income: 0, expense: 0, balance: 0 });
  });
});
