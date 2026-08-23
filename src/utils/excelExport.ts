import * as XLSX from "xlsx";
import { CreditCardEntry, Debt, DebtEvent, FinancialAccount, Movement } from "../types";
import { localDateString } from "./date";
import { UNASSIGNED_ACCOUNT_ID, accountNameForMovement } from "./accountHelpers";
import { describeFilters, MovementFilters, movementTotalsByCurrency } from "./movementFilters";
import { getMovementEconomics, movementLabel, resolveMovementCurrencyCode } from "./movementEconomics";

const moneyFormat = '#,##0.00';

export function exportMovementsExcel(
  movements: Movement[],
  accounts: FinancialAccount[] = [],
  debtEvents: DebtEvent[] = [],
  creditCardEntries: CreditCardEntry[] = [],
  debts: Debt[] = []
) {
  if (movements.length === 0) {
    window.alert("No hay movimientos para descargar con los filtros actuales.");
    return;
  }

  const rows = movements.map((movement) => {
    const economics = getMovementEconomics(movement, debtEvents, creditCardEntries);
    const resolvedCurrency = resolveMovementCurrencyCode(movement, accounts, debts, debtEvents, creditCardEntries);
    const currencyCode = resolvedCurrency ?? "SIN_RESOLVER";
    return {
      Fecha: movement.date,
      Moneda: currencyCode,
      Tipo: movementLabel(movement),
      Contexto: movement.movementContext,
      Descripcion: movement.description,
      Categoria: movement.category,
      Cuenta: accountNameForMovement(movement, accounts),
      Monto: movement.amount,
      "Salida de dinero": economics.cashOutflow,
      "Reduccion de principal": economics.principalReduction,
      "Gasto economico": economics.economicExpense,
      "Costo Debt sin clasificar": economics.unclassifiedDebtCost,
      "Salida Debt sin clasificar": economics.unresolvedDebtServiceOutflow,
      "Persona que registra": movement.person,
      "Fecha de creacion": formatDateTime(movement.createdAt ?? movement.date),
    };
  });

  const currencyTotalsResult = movementTotalsByCurrency(movements, debtEvents, creditCardEntries, accounts, debts);
  const currencies = Object.keys(currencyTotalsResult.byCurrency);

  const summaryAoa: unknown[][] = [
    ["Resumen por moneda", ""],
    [
      "Moneda",
      "Total ingresos",
      "Salidas de dinero",
      "Gasto economico",
      "Reduccion de principal",
      "Costo Debt sin clasificar",
      "Salida Debt sin clasificar",
      "Balance",
    ],
  ];

  for (const code of currencies) {
    const tot = currencyTotalsResult.byCurrency[code];
    summaryAoa.push([
      code,
      tot.income,
      tot.cashOutflow,
      tot.expense,
      tot.principalReduction,
      tot.unclassifiedDebtCost,
      tot.unresolvedDebtServiceOutflow,
      tot.balance,
    ]);
  }

  summaryAoa.push(["Cantidad total de movimientos exportados", movements.length]);
  if (currencyTotalsResult.unresolvedMovements.length > 0) {
    summaryAoa.push(["Movimientos con moneda sin resolver", currencyTotalsResult.unresolvedMovements.length]);
  }

  const summaryStart = rows.length + 3;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.sheet_add_aoa(worksheet, summaryAoa, { origin: `A${summaryStart}` });

  styleWorksheet(worksheet, [7, 8, 9, 10, 11, 12]);
  worksheet["!cols"] = [14, 10, 12, 16, 30, 22, 20, 14, 18, 20, 16, 22, 22, 24, 22].map((wch) => ({ wch }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Movimientos");
  XLSX.writeFile(workbook, `movimientos-caja-familiar-${todayFileName()}.xlsx`);
}

export function exportReportExcel(
  movements: Movement[],
  filters: MovementFilters,
  accounts: FinancialAccount[] = [],
  debtEvents: DebtEvent[] = [],
  creditCardEntries: CreditCardEntry[] = [],
  debts: Debt[] = []
) {
  if (movements.length === 0) {
    window.alert("No hay movimientos para descargar con los filtros actuales.");
    return;
  }

  const currencyTotalsResult = movementTotalsByCurrency(movements, debtEvents, creditCardEntries, accounts, debts);
  const currencies = Object.keys(currencyTotalsResult.byCurrency);
  const accountFilterName = filters.accountId ? (accounts.find((account) => account.id === filters.accountId)?.name ?? undefined) : undefined;

  const workbook = XLSX.utils.book_new();

  // 1. Resumen
  const summaryRows: unknown[][] = [
    ["Periodo seleccionado", describeFilters(filters, accountFilterName)],
    ["Resumen por moneda", ""],
    ["Moneda", "Total ingresos", "Salidas de dinero", "Gasto economico", "Balance"],
  ];

  for (const code of currencies) {
    const tot = currencyTotalsResult.byCurrency[code];
    summaryRows.push([code, tot.income, tot.cashOutflow, tot.expense, tot.balance]);
  }

  summaryRows.push(["Total movimientos", movements.length]);
  if (currencyTotalsResult.unresolvedMovements.length > 0) {
    summaryRows.push(["Movimientos con moneda sin resolver", currencyTotalsResult.unresolvedMovements.length]);
  }

  appendSheet(workbook, "Resumen", summaryRows, [1, 2, 3, 4]);

  // 2. Gastos por categoría por moneda
  const categoryRows: unknown[][] = [["Moneda", "Categoria", "Total gastado", "Porcentaje del gasto de la moneda"]];
  const accountRows: unknown[][] = [["Moneda", "Cuenta", "Total gastado"]];
  const topFiveRows: unknown[][] = [["Moneda", "Categoria", "Total gastado"]];

  for (const code of currencies) {
    const currMovements = movements.filter(
      (m) => resolveMovementCurrencyCode(m, accounts, debts, debtEvents, creditCardEntries) === code
    );
    const expenses = currMovements
      .filter((m) => m.type === "egreso")
      .map((m) => ({ ...m, amount: getMovementEconomics(m, debtEvents, creditCardEntries).economicExpense }));

    const byCat = groupBy(expenses, "category", accounts).filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
    const byAcc = groupBy(expenses, "accountId", accounts).filter((item) => item.total > 0).sort((a, b) => b.total - a.total);

    const positiveCategoryExpenseTotal = byCat.reduce((sum, item) => sum + item.total, 0);

    for (const cat of byCat) {
      const percentage = positiveCategoryExpenseTotal > 0 ? cat.total / positiveCategoryExpenseTotal : 0;
      categoryRows.push([code, cat.name, cat.total, percentage]);
    }
    for (const acc of byAcc) {
      accountRows.push([code, acc.name, acc.total]);
    }
    for (const top of byCat.slice(0, 5)) {
      topFiveRows.push([code, top.name, top.total]);
    }
  }

  appendSheet(workbook, "Gastos por categoria", categoryRows, [2]);
  appendSheet(workbook, "Gastos por cuenta", accountRows, [2]);
  appendSheet(workbook, "Top 5 categorias", topFiveRows, [2]);

  // 3. Movimientos incluidos
  appendSheet(
    workbook,
    "Movimientos incluidos",
    [
      ["Fecha", "Moneda", "Tipo", "Contexto", "Descripcion", "Categoria", "Cuenta", "Monto", "Salida de dinero", "Reduccion de principal", "Gasto economico", "Costo Debt sin clasificar", "Salida Debt sin clasificar", "Persona que registra"],
      ...movements.map((movement) => {
        const economics = getMovementEconomics(movement, debtEvents, creditCardEntries);
        const resolvedCurrency = resolveMovementCurrencyCode(movement, accounts, debts, debtEvents, creditCardEntries);
        const currencyCode = resolvedCurrency ?? "SIN_RESOLVER";
        return [movement.date, currencyCode, movementLabel(movement), movement.movementContext, movement.description, movement.category, accountNameForMovement(movement, accounts), movement.amount, economics.cashOutflow, economics.principalReduction, economics.economicExpense, economics.unclassifiedDebtCost, economics.unresolvedDebtServiceOutflow, movement.person];
      }),
    ],
    [7, 8, 9, 10, 11, 12]
  );

  XLSX.writeFile(workbook, `reporte-caja-familiar-${todayFileName()}.xlsx`);
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: unknown[][], moneyColumns: number[] = []) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  styleWorksheet(worksheet, moneyColumns);
  worksheet["!cols"] = rows[0]?.map(() => ({ wch: 24 })) ?? [];
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
}

function styleWorksheet(worksheet: XLSX.WorkSheet, moneyColumns: number[]) {
  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const header = worksheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    if (header) header.s = { font: { bold: true } };
  }
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    moneyColumns.forEach((column) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && typeof cell.v === "number") cell.z = moneyFormat;
    });
  }
}

function groupBy(items: Movement[], key: "category" | "accountId", accounts: FinancialAccount[] = []) {
  const totals = new Map<string, number>();
  items.forEach((item) => {
    const groupKey = key === "accountId" ? (item.accountId ?? UNASSIGNED_ACCOUNT_ID) : item[key];
    totals.set(groupKey, (totals.get(groupKey) ?? 0) + item.amount);
  });
  return [...totals.entries()].map(([name, total]) => ({ name: key === "accountId" ? readableAccountName(name, accounts) : name, total }));
}

function readableAccountName(key: string, accounts: FinancialAccount[]) {
  if (key === UNASSIGNED_ACCOUNT_ID) return "Sin cuenta (historico)";
  return accounts.find((account) => account.id === key)?.name ?? "Sin cuenta (historico)";
}

function todayFileName() {
  return localDateString();
}

function formatDateTime(value: string) {
  return value.includes("T") ? new Date(value).toLocaleString("es-PE") : value;
}

export function buildReportCategoryRowsByCurrency(
  movements: Movement[],
  accounts: FinancialAccount[] = [],
  debtEvents: DebtEvent[] = [],
  creditCardEntries: CreditCardEntry[] = [],
  debts: Debt[] = []
) {
  const currencyTotalsResult = movementTotalsByCurrency(movements, debtEvents, creditCardEntries, accounts, debts);
  const currencies = Object.keys(currencyTotalsResult.byCurrency);
  const categoryRows: Array<[string, string, number, number]> = [];

  for (const code of currencies) {
    const currMovements = movements.filter(
      (m) => resolveMovementCurrencyCode(m, accounts, debts, debtEvents, creditCardEntries) === code
    );
    const expenses = currMovements
      .filter((m) => m.type === "egreso")
      .map((m) => ({ ...m, amount: getMovementEconomics(m, debtEvents, creditCardEntries).economicExpense }));

    const byCat = groupBy(expenses, "category", accounts).filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
    const positiveCategoryExpenseTotal = byCat.reduce((sum, item) => sum + item.total, 0);

    for (const cat of byCat) {
      const percentage = positiveCategoryExpenseTotal > 0 ? cat.total / positiveCategoryExpenseTotal : 0;
      categoryRows.push([code, cat.name, cat.total, percentage]);
    }
  }

  return categoryRows;
}
