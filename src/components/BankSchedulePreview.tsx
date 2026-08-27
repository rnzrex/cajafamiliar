export interface BankSchedulePreviewRow {
  contractualInstallmentNumber: number;
  dueDate: string;
  principal: number | null;
  interest: number | null;
  insurance: number | null;
  fees: number | null;
  total: number | null;
  reportedBalance: number | null;
}

interface BankSchedulePreviewProps {
  rows: BankSchedulePreviewRow[];
  compact?: boolean;
  showBalance?: boolean;
  ariaLabel?: string;
}

function amount(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rowAmount(value: number | null): string {
  return value == null ? "—" : amount(value);
}

function ScheduleDetail({ row, showBalance }: { row: BankSchedulePreviewRow; showBalance: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-2 text-xs text-slate-700 sm:grid-cols-4">
      <span>Capital: <strong>{rowAmount(row.principal)}</strong></span>
      <span>Interés: <strong>{rowAmount(row.interest)}</strong></span>
      <span>Seguro: <strong>{rowAmount(row.insurance)}</strong></span>
      <span>Gastos: <strong>{rowAmount(row.fees)}</strong></span>
      {showBalance && <span>Saldo: <strong>{rowAmount(row.reportedBalance)}</strong></span>}
      <span className={showBalance ? "sm:col-span-3" : "sm:col-span-4"}>Total: <strong>{rowAmount(row.total)}</strong></span>
    </div>
  );
}

function rowsForDisplay(rows: BankSchedulePreviewRow[], compact: boolean): { rows: BankSchedulePreviewRow[]; truncated: boolean } {
  if (!compact || rows.length <= 4) return { rows, truncated: false };
  return { rows: [...rows.slice(0, 3), rows[rows.length - 1]!], truncated: true };
}

export function BankSchedulePreview({ rows, compact = false, showBalance = true, ariaLabel = "Vista previa del cronograma importado" }: BankSchedulePreviewProps) {
  const display = rowsForDisplay(rows, compact);
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="space-y-2 lg:hidden" aria-label={ariaLabel}>
        {display.rows.map((row, index) => (
          <details key={`${row.contractualInstallmentNumber}-${row.dueDate}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <summary className="grid cursor-pointer grid-cols-3 gap-2 text-xs font-black text-slate-800">
              <span>N° {row.contractualInstallmentNumber}</span>
              <span>Vence {row.dueDate}</span>
              <span>Total {rowAmount(row.total)}</span>
            </summary>
            <div className="mt-2"><ScheduleDetail row={row} showBalance={showBalance} /></div>
          </details>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 lg:block">
        <table className="min-w-full text-left text-xs" aria-label={ariaLabel}>
          <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2">N°</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Capital</th>
              <th className="px-3 py-2">Interés</th>
              <th className="px-3 py-2">Seguro</th>
              <th className="px-3 py-2">Gastos</th>
              <th className="px-3 py-2">Total</th>
              {showBalance && <th className="px-3 py-2">Saldo</th>}
            </tr>
          </thead>
          <tbody>
            {display.rows.map((row, index) => (
              <tr key={`${row.contractualInstallmentNumber}-${row.dueDate}-${index}`} className="border-t border-slate-100">
                <td className="px-3 py-2 font-bold">{row.contractualInstallmentNumber}</td>
                <td className="px-3 py-2">{row.dueDate}</td>
                <td className="px-3 py-2">{rowAmount(row.principal)}</td>
                <td className="px-3 py-2">{rowAmount(row.interest)}</td>
                <td className="px-3 py-2">{rowAmount(row.insurance)}</td>
                <td className="px-3 py-2">{rowAmount(row.fees)}</td>
                <td className="px-3 py-2 font-bold">{rowAmount(row.total)}</td>
                {showBalance && <td className="px-3 py-2">{rowAmount(row.reportedBalance)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {display.truncated && <p className="text-xs text-slate-500">Mostrando un resumen: 3 primeras y última de {rows.length} cuotas. Revisa el cronograma completo en 5. CRONOGRAMA.</p>}
    </div>
  );
}
