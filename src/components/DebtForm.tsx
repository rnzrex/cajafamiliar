import { useState, type ComponentProps } from "react";
import { ArrowLeft, FileSearch, Keyboard } from "lucide-react";
import type { DebtKind } from "../types";
import { DebtForm as LegacyDebtForm } from "./DebtFormLegacy";
import { DebtDocumentFirstOnboarding } from "./DebtDocumentFirstOnboarding";

type DebtFormProps = ComponentProps<typeof LegacyDebtForm>;
type EntryMode = "choose" | "document" | "manual";

export function DebtForm(props: DebtFormProps) {
  const [entryMode, setEntryMode] = useState<EntryMode>("choose");
  const [manualInitialKind, setManualInitialKind] = useState<DebtKind>(props.initialDebtKind ?? "bank_loan");

  if (entryMode === "manual") {
    return <LegacyDebtForm {...props} initialDebtKind={manualInitialKind} />;
  }

  if (entryMode === "document") {
    return (
      <DebtDocumentFirstOnboarding
        currentMember={props.currentMember}
        canWriteDebt={props.canWriteDebt}
        onSaved={props.onSaved}
        onCancel={props.onCancel}
        setToast={props.setToast}
        onBack={() => setEntryMode("choose")}
        onUseSpecializedFlow={(kind) => {
          setManualInitialKind(kind);
          setEntryMode("manual");
        }}
      />
    );
  }

  return (
    <section className="mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-xl lg:p-8">
      <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-4">
        <button type="button" onClick={props.onCancel} className="rounded-full bg-slate-100 p-2 text-slate-700 hover:bg-slate-200" aria-label="Volver"><ArrowLeft className="h-5 w-5" /></button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Registrar deuda</h2>
          <p className="text-sm text-slate-500">Empieza por el documento si lo tienes. Caja Familiar rellenará los datos antes de crear nada.</p>
        </div>
      </div>

      <div className="space-y-4">
        <button type="button" onClick={() => setEntryMode("document")} className="w-full rounded-2xl border-2 border-violet-300 bg-violet-50 p-5 text-left shadow-sm transition hover:border-violet-500 hover:bg-violet-100">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-violet-700 p-3 text-white"><FileSearch className="h-6 w-6" /></div>
            <div className="flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-lg font-black text-violet-950">Analizar documento con IA</p><span className="rounded-full bg-violet-700 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-white">Recomendado</span></div><p className="mt-1 text-sm text-violet-900">Copia el prompt, adjunta tu contrato/proforma/cronograma a ChatGPT, Gemini o Claude y pega el JSON. Valor del bien, cuota inicial, principal, tasa y cronograma se rellenan automáticamente para que tú solo revises.</p><p className="mt-2 text-xs font-semibold text-violet-800">No crea la deuda hasta que pulses «Confirmar y crear deuda».</p></div>
          </div>
        </button>

        <button type="button" onClick={() => { setManualInitialKind(props.initialDebtKind ?? "bank_loan"); setEntryMode("manual"); }} className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-slate-400 hover:bg-slate-50">
          <div className="flex items-start gap-4"><div className="rounded-xl bg-slate-100 p-3 text-slate-700"><Keyboard className="h-6 w-6" /></div><div><p className="text-lg font-black text-slate-900">Ingresar datos manualmente</p><p className="mt-1 text-sm text-slate-600">Mantiene el formulario anterior para créditos bancarios, empeños o cuando no tienes un documento que analizar.</p></div></div>
        </button>
      </div>

      <div className="mt-6 flex justify-end border-t border-slate-100 pt-4"><button type="button" onClick={props.onCancel} className="rounded-xl px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-100">Cancelar</button></div>
    </section>
  );
}
