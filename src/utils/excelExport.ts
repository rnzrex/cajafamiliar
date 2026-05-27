import * as XLSX from "xlsx";
import { Movement } from "../types";
import { describeFilters, MovementFilters, movementTotals } from "./movementFilters";

const moneyFormat = '"S/" #,##0.00';

export function exportMovementsExcel(movements: Movement[]) {
  if (movements.length === 0) {
    window.alert("No hay movimientos para descargar con los filtros actuales.");
    return;
  }

  const rows = movements.map((movement) => ({
    Fecha: movement.date,
    Tipo: movement.type,
    Descripcion: movement.description,
    Categoria: movement.category,
    "Metodo de pago": movement.method,
    Monto: movement.amount,
    "Persona que registra": movement.person,
    "Fecha de creacion": formatDateTime(movement.createdAt ?? movement.date),
  }));

  const totals = movementTotals(movements);
  const summaryStart = rows.length + 3;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.sheet_add_aoa(
    worksheet,
    [
      ["Resumen", ""],
      ["Total ingresos", totals.income],
      ["Total egresos", totals.expense],
      ["Balance", totals.balance],
      ["Cantidad de movimientos exportados", movements.length],
    ],
    { origin: `A${summaryStart}` }
  );

  styleWorksheet(worksheet, [5, 10, 11, 12]);
  worksheet["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 24 }, { wch: 22 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Movimientos");
  XLSX.writeFile(workbook, `movimientos-caja-familiar-${todayFileName()}.xlsx`);
}

export function exportReportExcel(movements: Movement[], filters: MovementFilters) {
  if (movements.length === 0) {
    window.alert("No hay movimientos para descargar con los filtros actuales.");
    return;
  }

  const expenses = movements.filter((movement) => movement.type === "egreso");
  const totals = movementTotals(movements);
  const byCategory = groupBy(expenses, "category").sort((a, b) => b.total - a.total);
  const byMethod = groupBy(expenses, "method").sort((a, b) => b.total - a.total);
  const topFive = byCategory.slice(0, 5);
  const totalExpense = totals.expense || 1;

  const workbook = XLSX.utils.book_new();
  appendSheet(
    workbook,
    "Resumen",
    [
      ["Periodo seleccionado", describeFilters(filters)],
      ["Total ingresos", totals.income],
      ["Total egresos", totals.expense],
      ["Balance", totals.balance],
      ["Total movimientos", movements.length],
      ["Categoria con mayor gasto", byCategory[0]?.name ?? "Sin gastos"],
      ["Metodo de pago mas usado", byMethod[0]?.name ?? "Sin gastos"],
    ],
    [1, 2, 3]
  );

  appendSheet(
    workbook,
    "Gastos por categoria",
    [["Categoria", "Total gastado", "Porcentaje del gasto total"], ...byCategory.map((item) => [item.name, item.total, item.total / totalExpense])],
    [1]
  );
  appendSheet(workbook, "Ingresos vs egresos", [["Tipo", "Total"], ["Ingresos", totals.income], ["Egresos", totals.expense]], [1]);
  appendSheet(workbook, "Gastos por metodo", [["Metodo de pago", "Total"], ...byMethod.map((item) => [item.name, item.total])], [1]);
  appendSheet(workbook, "Top 5 categorias", [["Categoria", "Total"], ...topFive.map((item) => [item.name, item.total])], [1]);
  appendSheet(
    workbook,
    "Movimientos incluidos",
    [
      ["Fecha", "Tipo", "Descripcion", "Categoria", "Metodo de pago", "Monto", "Persona que registra"],
      ...movements.map((movement) => [movement.date, movement.type, movement.description, movement.category, movement.method, movement.amount, movement.person]),
    ],
    [5]
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

function groupBy(items: Movement[], key: "category" | "method") {
  const totals = new Map<string, number>();
  items.forEach((item) => totals.set(item[key], (totals.get(item[key]) ?? 0) + item.amount));
  return [...totals.entries()].map(([name, total]) => ({ name, total }));
}

function todayFileName() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  return value.includes("T") ? new Date(value).toLocaleString("es-PE") : value;
}
