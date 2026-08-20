import { afterEach, describe, expect, it, vi } from "vitest";
import type { CashCount, Movement, RecurringPayment } from "../types";
import { expectedCash, isPaymentFinished, lastCashCount, monthlyTotals, paymentStatus, topExpenseCategory } from "./calculations";

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

function payment(overrides: Partial<RecurringPayment>): RecurringPayment {
  return {
    id: "p1",
    name: "Pago",
    amount: 100,
    amount_mode: "fixed",
    dueDay: null,
    dueDate: null,
    category: "Servicios",
    status: "pendiente",
    notes: "",
    recurrence_type: "indefinite",
    total_installments: null,
    paid_installments: 0,
    is_active: true,
    last_paid_month: null,
    last_paid_year: null,
    ...overrides,
  };
}

function setSystemTime(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("expectedCash", () => {
  it("parte del saldo inicial cuando no hay movimientos", () => {
    expect(expectedCash([], 1000)).toBe(1000);
  });

  it("suma los ingresos en efectivo", () => {
    const movements = [movement({ type: "ingreso", amount: 100 })];
    expect(expectedCash(movements, 0)).toBe(100);
  });

  it("resta los egresos en efectivo", () => {
    const movements = [movement({ type: "egreso", amount: 50 })];
    expect(expectedCash(movements, 1000)).toBe(950);
  });

  it("Yape no afecta la caja", () => {
    const movements = [movement({ type: "ingreso", amount: 500, method: "Yape" })];
    expect(expectedCash(movements, 1000)).toBe(1000);
  });

  it("tarjeta no afecta la caja", () => {
    const movements = [movement({ type: "egreso", amount: 200, method: "tarjeta" })];
    expect(expectedCash(movements, 1000)).toBe(1000);
  });

  it("transferencia no afecta la caja", () => {
    const movements = [movement({ type: "ingreso", amount: 300, method: "transferencia" })];
    expect(expectedCash(movements, 1000)).toBe(1000);
  });

  it("combina varios movimientos ignorando los no efectivo", () => {
    const movements = [
      movement({ type: "ingreso", amount: 100, method: "efectivo" }),
      movement({ type: "egreso", amount: 40, method: "efectivo" }),
      movement({ type: "ingreso", amount: 500, method: "Yape" }),
      movement({ type: "egreso", amount: 300, method: "tarjeta" }),
    ];
    expect(expectedCash(movements, 1000)).toBe(1060);
  });

  it("filtra por la cuenta de efectivo cuando se indica su id", () => {
    const movements = [
      movement({ type: "ingreso", amount: 100, method: "efectivo", accountId: "cash-1" }),
      movement({ type: "egreso", amount: 40, method: "efectivo", accountId: "cash-1" }),
      movement({ type: "ingreso", amount: 500, method: "Yape", accountId: "yape-1" }),
    ];
    expect(expectedCash(movements, 1000, "cash-1")).toBe(1060);
  });

  it("ignora movimientos de otras cuentas al filtrar por cuenta de efectivo", () => {
    const movements = [
      movement({ type: "ingreso", amount: 100, method: "efectivo", accountId: "cash-1" }),
      movement({ type: "ingreso", amount: 500, method: "Yape", accountId: "yape-1" }),
    ];
    expect(expectedCash(movements, 1000, "cash-1")).toBe(1100);
  });

  it("incluye movimientos legacy en efectivo sin cuenta como respaldo de la cuenta cash", () => {
    const movements = [
      movement({ type: "egreso", amount: 40, method: "efectivo", accountId: null }),
      movement({ type: "egreso", amount: 30, method: "efectivo", accountId: "cash-1" }),
    ];
    expect(expectedCash(movements, 1000, "cash-1")).toBe(930);
  });
});

describe("monthlyTotals", () => {
  const movements = [
    movement({ id: "a", type: "ingreso", date: "2026-08-20", amount: 100 }),
    movement({ id: "b", type: "ingreso", date: "2026-08-05", amount: 250 }),
    movement({ id: "c", type: "egreso", date: "2026-08-10", amount: 40 }),
    movement({ id: "d", type: "egreso", date: "2026-08-15", amount: 80 }),
    movement({ id: "e", type: "ingreso", date: "2026-07-30", amount: 999 }),
  ];

  it("filtra por mes", () => {
    const totals = monthlyTotals(movements, "2026-08");
    expect(totals.income).toBe(350);
    expect(totals.expense).toBe(120);
  });

  it("suma los ingresos correctamente", () => {
    expect(monthlyTotals(movements, "2026-08").income).toBe(350);
  });

  it("suma los egresos correctamente", () => {
    expect(monthlyTotals(movements, "2026-08").expense).toBe(120);
  });

  it("devuelve ceros para un mes sin movimientos", () => {
    expect(monthlyTotals(movements, "2025-01")).toEqual({ income: 0, expense: 0 });
  });

  it("usa el mes local actual por defecto", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    expect(monthlyTotals(movements)).toEqual({ income: 350, expense: 120 });
  });
});

describe("topExpenseCategory", () => {
  const movements = [
    movement({ id: "a", date: "2026-08-10", amount: 200, category: "Comida / cenas" }),
    movement({ id: "b", date: "2026-08-15", amount: 150, category: "Mercado" }),
    movement({ id: "c", date: "2026-08-20", amount: 90, category: "Salud" }),
    movement({ id: "d", date: "2026-07-30", amount: 9999, category: "Transporte" }),
    movement({ id: "e", type: "ingreso", date: "2026-08-01", amount: 5000, category: "Negocio" }),
  ];

  it("devuelve la categoría con mayor gasto del mes", () => {
    expect(topExpenseCategory(movements, "2026-08")).toBe("Comida / cenas");
  });

  it("ignora otros meses", () => {
    expect(topExpenseCategory(movements, "2026-08")).not.toBe("Transporte");
  });

  it("ignora ingresos", () => {
    expect(topExpenseCategory(movements, "2026-08")).not.toBe("Negocio");
  });

  it("devuelve 'Sin gastos' cuando no hay gastos en el mes", () => {
    expect(topExpenseCategory(movements, "2025-01")).toBe("Sin gastos");
  });
});

describe("lastCashCount", () => {
  const counts: CashCount[] = [
    { id: "c1", createdAt: "2026-08-10T00:00:00.000Z", denominations: {}, total: 100, expected: 100, difference: 0, accountId: null },
    { id: "c2", createdAt: "2026-08-15T00:00:00.000Z", denominations: {}, total: 200, expected: 210, difference: -10, accountId: null },
  ];

  it("devuelve el conteo más reciente por createdAt", () => {
    expect(lastCashCount(counts)?.id).toBe("c2");
  });

  it("devuelve undefined cuando no hay conteos", () => {
    expect(lastCashCount([])).toBeUndefined();
  });
});

describe("isPaymentFinished", () => {
  it("true para un pago fijo con todas las cuotas pagadas", () => {
    expect(isPaymentFinished(payment({ recurrence_type: "fixed", total_installments: 3, paid_installments: 3 }))).toBe(true);
  });

  it("false mientras falten cuotas", () => {
    expect(isPaymentFinished(payment({ recurrence_type: "fixed", total_installments: 3, paid_installments: 2 }))).toBe(false);
  });

  it("false para pagos indefinidos", () => {
    expect(isPaymentFinished(payment({ recurrence_type: "indefinite" }))).toBe(false);
  });

  it("false cuando no hay total de cuotas", () => {
    expect(isPaymentFinished(payment({ recurrence_type: "fixed", total_installments: null, paid_installments: 3 }))).toBe(false);
  });
});

describe("paymentStatus", () => {
  it("pago vencido hace 5 días", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 15 }));
    expect(status.kind).toBe("overdue");
    expect(status.days).toBe(-5);
    expect(status.label).toBe("Vencido hace 5 días");
  });

  it("pago vencido hace 1 día usa singular", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 19 }));
    expect(status.kind).toBe("overdue");
    expect(status.label).toBe("Vencido hace 1 día");
  });

  it("pago que vence hoy", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 20 }));
    expect(status.kind).toBe("today");
    expect(status.days).toBe(0);
    expect(status.label).toBe("Vence hoy");
    expect(status.dueDate).toBe("2026-08-20");
  });

  it("pago que vence mañana", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 21 }));
    expect(status.kind).toBe("tomorrow");
    expect(status.days).toBe(1);
    expect(status.label).toBe("Vence mañana");
    expect(status.dueDate).toBe("2026-08-21");
  });

  it("pago próximo dentro de 7 días", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 25 }));
    expect(status.kind).toBe("upcoming");
    expect(status.days).toBe(5);
    expect(status.label).toBe("Vence en 5 días");
  });

  it("pago más lejano cae en later", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 30 }));
    expect(status.kind).toBe("later");
    expect(status.days).toBe(10);
  });

  it("pago pagado este mes", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 20, last_paid_month: 8, last_paid_year: 2026 }));
    expect(status.kind).toBe("paid");
    expect(status.label).toBe("Pagado este mes");
  });

  it("pago fijo finalizado", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ recurrence_type: "fixed", total_installments: 5, paid_installments: 5 }));
    expect(status.kind).toBe("completed");
    expect(status.label).toBe("Finalizado");
  });

  it("one_time pagado", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ recurrence_type: "one_time", dueDate: "2026-08-10", status: "pagado" }));
    expect(status.kind).toBe("completed");
    expect(status.label).toBe("Pagado");
  });

  it("one_time vencido", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ recurrence_type: "one_time", dueDate: "2026-08-10", status: "pendiente" }));
    expect(status.kind).toBe("overdue");
  });

  it("one_time próximo", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ recurrence_type: "one_time", dueDate: "2026-08-25", status: "pendiente" }));
    expect(status.kind).toBe("upcoming");
  });

  it("pago inactivo", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ is_active: false }));
    expect(status.kind).toBe("inactive");
  });

  it("dueDay 31 en febrero se ajusta al último día del mes", () => {
    setSystemTime("2026-02-25T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 31 }));
    expect(status.dueDate).toBe("2026-02-28");
    expect(status.kind).toBe("upcoming");
  });

  it("dueDay 29 en febrero bisiesto se mantiene", () => {
    setSystemTime("2028-02-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: 29 }));
    expect(status.dueDate).toBe("2028-02-29");
  });

  it("dueDay 30 y 31 en un mes de 30 días se ajustan a 30", () => {
    setSystemTime("2026-04-10T12:00:00Z");
    expect(paymentStatus(payment({ dueDay: 30 })).dueDate).toBe("2026-04-30");
    expect(paymentStatus(payment({ dueDay: 31 })).dueDate).toBe("2026-04-30");
  });

  it("dueDay 31 en un mes de 31 días se mantiene", () => {
    setSystemTime("2026-08-10T12:00:00Z");
    expect(paymentStatus(payment({ dueDay: 31 })).dueDate).toBe("2026-08-31");
  });

  it("devuelve later cuando el día de vencimiento no está definido", () => {
    setSystemTime("2026-08-20T12:00:00Z");
    const status = paymentStatus(payment({ dueDay: null, recurrence_type: "indefinite" }));
    expect(status.kind).toBe("later");
    expect(status.label).toBe("Fecha por confirmar");
  });
});
