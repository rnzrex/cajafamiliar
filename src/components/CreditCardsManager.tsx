import { useMemo, useState } from "react";
import { AlertCircle, Archive, CreditCard, Plus, Search, WalletCards } from "lucide-react";
import type { CreditCardEntry, CreditCardProfile, CreditCardStatement, Debt } from "../types.js";
import {
  buildCreditCardIntelligenceItem,
  buildCreditCardStatementAlerts,
  selectUrgentCreditCardStatementAlertsForReminder,
} from "../utils/creditCardCalculations.js";
import { formatMoneyByCurrency } from "../utils/calculations.js";
import { formatDebtStatus } from "../utils/debtViewModel.js";

interface CreditCardsManagerProps {
  cards: Debt[];
  profiles: CreditCardProfile[];
  entries: CreditCardEntry[];
  statements: CreditCardStatement[];
  onOpenNewCard: () => void;
  onSelectCard: (card: Debt) => void;
}

type CardTab = "active" | "archived";

export function CreditCardsManager({
  cards,
  profiles,
  entries,
  statements,
  onOpenNewCard,
  onSelectCard,
}: CreditCardsManagerProps) {
  const [tab, setTab] = useState<CardTab>("active");
  const [searchQuery, setSearchQuery] = useState("");

  const alerts = useMemo(
    () =>
      buildCreditCardStatementAlerts({
        debts: cards,
        creditCardProfiles: profiles,
        creditCardEntries: entries,
        creditCardStatements: statements,
      }),
    [cards, entries, profiles, statements]
  );
  const urgentAlerts = useMemo(() => selectUrgentCreditCardStatementAlertsForReminder(alerts), [alerts]);
  const alertByDebtId = useMemo(() => new Map(alerts.map((alert) => [alert.debtId, alert])), [alerts]);

  const filteredCards = cards.filter((card) => {
    const isOperational = card.status === "active" && !card.isArchived;
    const matchesTab = tab === "archived" ? !isOperational : isOperational;
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !query || card.name.toLowerCase().includes(query) || card.creditorName.toLowerCase().includes(query);
    return matchesTab && matchesQuery;
  });

  const activeCards = cards.filter((card) => card.status === "active" && !card.isArchived);
  const activeBalances = new Map<string, number>();
  for (const card of activeCards) {
    const item = buildCardItem(card, profiles, entries, statements);
    activeBalances.set(card.currencyCode, (activeBalances.get(card.currencyCode) ?? 0) + item.currentBalance);
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 rounded-3xl bg-slate-900 p-6 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between lg:p-8">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-blue-500/20 p-3 text-blue-300">
            <CreditCard className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-2xl font-black">Tarjetas</h2>
            <p className="text-sm text-slate-300">Compras, estados de cuenta y pagos sin mezclarlos con tus deudas.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenNewCard}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-500 px-5 py-3 font-black text-white shadow-md transition hover:bg-blue-400 active:scale-95"
        >
          <Plus className="h-5 w-5" /> Registrar tarjeta
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Tarjetas activas" value={String(activeCards.length)} detail={`${urgentAlerts.length} requieren atención`} />
        {[...activeBalances.entries()].slice(0, 2).map(([currencyCode, balance]) => (
          <SummaryCard
            key={currencyCode}
            label={`Saldo total ${currencyCode}`}
            value={formatMoneyByCurrency(balance, currencyCode)}
            detail="Calculado desde el ledger de tarjetas"
          />
        ))}
        {activeBalances.size === 0 && <SummaryCard label="Saldo total" value="Sin tarjetas" detail="Registra tu primera tarjeta para comenzar" />}
      </div>

      {urgentAlerts.length > 0 && (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6" aria-label="Alertas de tarjetas">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-700" />
            <h3 className="text-lg font-black text-amber-950">Requiere tu atención</h3>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {urgentAlerts.map((alert) => (
              <button
                key={alert.dedupeKey}
                type="button"
                onClick={() => {
                  const card = cards.find((item) => item.id === alert.debtId);
                  if (card) onSelectCard(card);
                }}
                className="rounded-2xl border border-amber-200 bg-white p-4 text-left transition hover:border-amber-400 hover:shadow-sm"
              >
                <p className="font-black text-slate-900">{alert.cardName}</p>
                <p className="mt-1 text-sm font-semibold text-amber-800">{alert.dueLabel}</p>
                <p className="mt-1 text-xs text-slate-500">Vence {alert.dueDate} · {formatMoneyByCurrency(alert.statementBalance, alert.currencyCode)}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-3xl bg-white p-5 shadow-xl sm:p-6 lg:p-8">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab("active")}
              className={`min-h-11 rounded-xl px-4 py-2 text-sm font-black transition ${tab === "active" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              Activas ({cards.filter((card) => card.status === "active" && !card.isArchived).length})
            </button>
            <button
              type="button"
              onClick={() => setTab("archived")}
              className={`min-h-11 flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition ${tab === "archived" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              <Archive className="h-4 w-4" /> Archivadas / no operativas ({cards.filter((card) => card.status !== "active" || card.isArchived).length})
            </button>
          </div>
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Buscar tarjeta</span>
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar tarjeta o banco..."
              className="h-11 w-full rounded-xl border border-slate-300 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-blue-600"
            />
          </label>
        </div>

        {filteredCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-12 text-center">
            <WalletCards className="h-12 w-12 text-slate-300" />
            <p className="mt-3 text-base font-black text-slate-700">{tab === "archived" ? "No hay tarjetas archivadas" : "No tienes tarjetas registradas"}</p>
            <p className="mt-1 text-sm text-slate-500">Las tarjetas archivadas o no operativas siguen disponibles como historial.</p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredCards.map((card) => {
              const item = buildCardItem(card, profiles, entries, statements);
              const alert = alertByDebtId.get(card.id);
              const statusLabel = card.isArchived ? "Archivada" : formatDebtStatus(card.status);
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => onSelectCard(card)}
                  className="group flex min-h-64 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-500 hover:shadow-md active:scale-[0.99]"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="rounded-xl bg-slate-900 p-2.5 text-blue-300"><CreditCard className="h-5 w-5" /></div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${card.isArchived ? "border-slate-200 bg-slate-100 text-slate-600" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <h3 className="mt-4 text-lg font-black text-slate-900 group-hover:text-blue-700">{card.name}</h3>
                    <p className="text-sm text-slate-500">{card.creditorName} · {card.currencyCode}{item.latestStatementDueDate ? ` · vence ${item.latestStatementDueDate}` : ""}</p>
                    {alert && <p className="mt-3 rounded-xl bg-amber-50 p-2.5 text-xs font-bold text-amber-800">{alert.dueLabel}</p>}
                  </div>
                  <div className="mt-5 flex items-end justify-between border-t border-slate-100 pt-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Saldo actual</p>
                      <p className="text-xl font-black text-slate-900">{formatMoneyByCurrency(item.currentBalance, card.currencyCode)}</p>
                      {item.availableCredit !== null && <p className="text-xs text-slate-500">Disponible {formatMoneyByCurrency(item.availableCredit, card.currencyCode)}</p>}
                    </div>
                    <span className="text-sm font-black text-blue-700 transition group-hover:translate-x-1">Ver detalle →</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function buildCardItem(
  card: Debt,
  profiles: CreditCardProfile[],
  entries: CreditCardEntry[],
  statements: CreditCardStatement[]
) {
  return buildCreditCardIntelligenceItem({
    debt: card,
    profile: profiles.find((profile) => profile.debtId === card.id),
    entries,
    statements,
  });
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p>
    </div>
  );
}
