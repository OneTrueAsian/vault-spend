import type { ConfirmedCutPreview, CutPreviewCalculation, CutPreviewDraft, CutPreviewIntent } from "./askVault/cutPreviewContract";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { ModalShell } from "./Modal";
import { MenuSelect } from "./MenuSelect";
import { DateField } from "./DateField";
import { validateCutPreviewIntent } from "./askVault/cutPreviewContract";
import { baselineRows, countedMonths, datesText, longDate, partMonths, wholeMonthsOnly, typedDollars } from "./askVault/spendingScenarioView";
import { scenarioBaselineProblem, scenarioMoneyToCents, scenarioMonthlyBaseline } from "./askVault/spendingScenarioMath";
import { sameScenarioSource } from "./askVault/spendingScenarioBaseline";
import type { ScenarioBaseline, SpendingScenarioIntent } from "./askVault/spendingScenarioContract";
import "./SpendingScenarioDialog.css";
import "./CutPreviewDialog.css";

export type CutPreviewScreen =
  | { stage: "choices"; draft: CutPreviewDraft; today: string; categories: readonly string[] }
  | { stage: "reading"; categories: readonly string[] }
  | { stage: "review"; scenario: Omit<ConfirmedCutPreview, "confirmed"> }
  | { stage: "result"; calculation: Extract<CutPreviewCalculation, { kind: "preview" }> }
  | { stage: "blocked"; calculation: Exclude<CutPreviewCalculation, { kind: "preview" }> }
  | { stage: "stale" | "error"; message: string };
export type CutPreviewDialogProps = {
  screen: CutPreviewScreen;
  onChoices: (intent: CutPreviewIntent) => void;
  onConfirm: (scenario: ConfirmedCutPreview) => void;
  onRemoveCategory: (category: string) => void;
  onEdit: () => void;
  onRestart: () => void;
  onClose: () => void;
};
type HistoryChoice = { kind: "recorded" | "manual" | null; amount: string };
type ChoiceRow = Omit<CutPreviewDraft["categories"][number], "maximumReduction"> & {
  maximumReduction: { kind: "money" | "percent" | null; amount: string } | null;
};
type Form = {
  amount: string; basis: "monthly" | "total" | null; rows: ChoiceRow[]; exclusions: string[];
  rangeChoice: "remaining-year" | "full-year" | "custom" | null;
  from: string; to: string; part: "exclude" | "prorate" | null;
  history: Record<string, HistoryChoice>;
};
function initial(screen: CutPreviewScreen): Form {
  const d = screen.stage === "choices" ? screen.draft : null;
  return { amount: d?.target.amount ?? "", basis: d?.target.kind ?? null, rows: structuredClone(d?.categories ?? []), exclusions: [...(d?.excludedCategories ?? [])],
    rangeChoice: null, from: "", to: "", part: d?.partialMonth ?? null, history: {} };
}
const cents = (s: string) => { const v = BigInt(s).toString().padStart(3, "0"); return typedDollars(v.slice(0, -2) + "." + v.slice(-2)); };
const money = (v: { numerator: string; denominator: string }) => typedDollars(scenarioMoneyToCents(v));
const CAUTION = "This is an illustration of lower planned spending, not money promised to be in your bank account. No investment growth is included. Nothing in your data was changed.";
const COVERAGE_NOTE = "A month counts when your records cover it. I cannot tell if you forgot to import something.";
function amountProblem(text: string, percent = false): string | undefined {
  if (!text) return undefined;
  if (scenarioBaselineProblem({ kind: "manual", monthlyAmount: text.trim(), source: { generation: 0, sessionRevision: 0, revision: { local: 0, external: 0 }, asOf: "2000-01-01" } }, false)) return "Enter a nonnegative amount with at most two decimal places.";
  if (percent) {
    const [whole, part = ""] = text.trim().split(".");
    if (BigInt(whole + part.padEnd(2, "0")) > 10000n) return "Choose a percentage from 0 to 100.";
  }
}
function scheduleText(intent: CutPreviewIntent) { return datesText({ cadence: "monthly", horizon: intent.horizon, partialMonth: intent.partialMonth } as SpendingScenarioIntent); }

/** Presentation and deliberate choices only. The controller must recheck live source/roster before reading or calculating. */
export function CutPreviewDialog({ screen, onChoices, onConfirm, onRemoveCategory, onEdit, onRestart, onClose }: CutPreviewDialogProps) {
  const group = useId(), anchor = useRef<HTMLSpanElement>(null);
  const [form, setForm] = useState(() => initial(screen));
  const identity = JSON.stringify(screen), [seen, setSeen] = useState(identity);
  if (seen !== identity) { setSeen(identity); setForm(initial(screen)); }
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }));
  useLayoutEffect(() => {
    const dialog = anchor.current?.closest<HTMLElement>('[role="dialog"]');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    if (dialog && dialogs[dialogs.length - 1] === dialog && !dialog.contains(document.activeElement)) dialog.focus();
  }, [identity]);
  const close = <button type="button" className="modal-secondary" onClick={onClose}>Close</button>;
  const option = (name: string, label: string, checked: boolean, action: () => void, hint?: string, disabled = false) => (
    <label className="scenario-option" aria-disabled={disabled || undefined}><input type="radio" name={group + name} checked={checked} disabled={disabled} onChange={action} /><span>{label}{hint && <small>{hint}</small>}</span></label>
  );
  const shell = (title: string, content: React.ReactNode, action?: React.ReactNode) => <ModalShell title={title} wide onCancel={onClose} dismissOnOverlayClick={false}
    footer={<div className="modal-actions">{close}{action}</div>}><span ref={anchor} hidden /><div className="cut-preview-content">{content}</div></ModalShell>;
  const field = (label: string, value: string, change: (value: string) => void, problem?: string) => {
    const errorId = group + "-" + encodeURIComponent(label) + "-error";
    return <label className="modal-field"><span>{label}</span><input aria-label={label} inputMode="decimal" value={value} aria-invalid={!!problem} aria-describedby={problem ? errorId : undefined} onChange={e => change(e.target.value)} />{problem && <small className="scenario-problem" id={errorId}>{problem}</small>}</label>;
  };

  if (screen.stage === "choices") {
    const { draft, today, categories } = screen, year = today.slice(0, 4);
    const update = (category: string, patch: Partial<ChoiceRow>) => set({ rows: form.rows.map(row => row.category === category ? { ...row, ...patch } : row) });
    let horizon = draft.horizon;
    if (!horizon && form.rangeChoice === "remaining-year") horizon = { kind: "prospective", from: today, to: year + "-12-31" };
    if (!horizon && form.rangeChoice === "full-year") horizon = { kind: "full-year-hypothetical", from: year + "-01-01", to: year + "-12-31" };
    if (!horizon && form.rangeChoice === "custom" && form.from && form.to) horizon = { kind: "prospective", from: form.from, to: form.to };
    // Date validation precedes calendar iteration. Never iterate over a malformed/unbounded range.
    const horizonValid = horizon && validateCutPreviewIntent({ version: 1, target: { kind: "monthly", amount: "0" }, allocationPolicy: "capacity-proportional", categories: [{ category: "__dates__", monthlyFloor: "0", maximumReduction: { kind: "money", amount: "0" } }], horizon, partialMonth: "prorate" }, { asOf: today, categories: ["__dates__"] });
    const validHorizon = horizonValid?.ok === true;
    const parts = horizon && validHorizon && horizon.kind === "prospective" ? partMonths(horizon) : [];
    const whole = horizon && validHorizon && parts.length ? wholeMonthsOnly(horizon) : null;
    const partialMonth = horizon && validHorizon && (horizon.kind === "full-year-hypothetical" || !parts.length) ? "exclude" : form.part;
    const resolvedHorizon = horizon && parts.length && partialMonth === "exclude" ? (whole ? { ...horizon, ...whole } : null) : horizon;
    const intent = { version: 1, target: { kind: form.basis, amount: form.amount.trim() }, allocationPolicy: "capacity-proportional", categories: form.rows, horizon: resolvedHorizon, partialMonth };
    const check = validateCutPreviewIntent(intent, { asOf: today, categories: [...categories] });
    const selected = new Set(form.rows.map(row => row.category));
    const unknown = form.rows.some(row => !categories.includes(row.category) || form.exclusions.includes(row.category));
    const ready = check.ok && !unknown;
    const yearHint = draft.scheduleHints?.find(h => h.kind === "year-choice");
    const canFullYear = !yearHint || yearHint.kind !== "year-choice" || yearHint.choices.includes("full-year-hypothetical");
    return shell("Where would you like to cut back?", <>
      <p className="scenario-banner" role="status"><strong>Nothing has been calculated yet.</strong> {draft.sourceText}</p>
      {field("Savings target", form.amount, amount => set({ amount }), amountProblem(form.amount))}
      <fieldset className="scenario-question"><legend>What does that target mean?</legend>
        {option("basis", "Every month", form.basis === "monthly", () => set({ basis: "monthly" }))}
        {option("basis", "A total over these dates", form.basis === "total", () => set({ basis: "total" }))}
      </fieldset>
      <fieldset className="scenario-question"><legend>Choose up to 20 categories</legend><p>Nothing is selected for you. Choose a monthly floor and maximum cut for every selected category.</p>
        {categories.map(category => {
          const row = form.rows.find(r => r.category === category), excluded = form.exclusions.includes(category);
          return <div className="cut-preview-category" key={category}>
            <label className="cut-preview-selection"><input type="checkbox" aria-label={"Select " + category} checked={selected.has(category)} disabled={excluded || (!row && selected.size >= 20)}
              onChange={() => set({ rows: row ? form.rows.filter(r => r.category !== category) : [...form.rows, { category, monthlyFloor: null, maximumReduction: null }] })} /><strong>{category}</strong></label>
            {excluded && <p>Excluded by your question. <button type="button" className="scenario-link" onClick={() => set({ exclusions: form.exclusions.filter(c => c !== category) })}>Allow selecting {category}</button></p>}
            {row && <>
              <div className="cut-preview-controls">
                {field(category + " monthly floor", row.monthlyFloor ?? "", monthlyFloor => update(category, { monthlyFloor }), amountProblem(row.monthlyFloor ?? ""))}
                {field(category + " maximum cut", row.maximumReduction?.amount ?? "", amount => update(category, { maximumReduction: { kind: row.maximumReduction?.kind ?? null, amount } }), amountProblem(row.maximumReduction?.amount ?? "", row.maximumReduction?.kind === "percent"))}
                <div className="modal-field"><span>{category} maximum cut unit</span><MenuSelect ariaLabel={category + " maximum cut unit"} value={row.maximumReduction?.kind ?? ""} placeholder="Choose dollars or percent" fill options={[{ value: "money", label: "Dollars per month" }, { value: "percent", label: "Percent of usual month" }]}
                  onChange={kind => update(category, { maximumReduction: { kind: kind as "money" | "percent", amount: row.maximumReduction?.amount ?? "" } })} /></div>
              </div>
              <button type="button" className="modal-secondary" onClick={() => update(category, { monthlyFloor: "0", maximumReduction: { kind: "percent", amount: "100" } })}>Allow up to 100% with floor $0 for {category}</button>
            </>}
          </div>;
        })}
      </fieldset>
      {unknown && <p role="alert" className="scenario-problem">A selected category is unavailable or excluded. Change the selection before continuing.</p>}
      {draft.scheduleHints?.length ? <aside className="scenario-banner" aria-label="Dates mentioned in your question"><p>Choose the exact schedule before continuing.</p><ul>{draft.scheduleHints.map((h, i) => <li key={i}>{h.text}</li>)}</ul>
        {draft.scheduleHints.filter(h => h.kind === "single-date" && h.date).map(h => h.kind === "single-date" && <button key={h.start} type="button" className="modal-secondary" onClick={() => set({ rangeChoice: "custom", from: h.date!, to: "", part: null })}>Use this as the start date: {longDate(h.date!)}</button>)}
      </aside> : null}
      {!draft.horizon && <fieldset className="scenario-question"><legend>Which dates should I use?</legend>
        {option("dates", "From now until December 31, " + year, form.rangeChoice === "remaining-year", () => set({ rangeChoice: "remaining-year", part: null }))}
        {canFullYear && option("dates", "The whole of " + year + " as a what-if", form.rangeChoice === "full-year", () => set({ rangeChoice: "full-year", part: null }), "It includes months that have already passed.")}
        {option("dates", "Dates I choose", form.rangeChoice === "custom", () => set({ rangeChoice: "custom", part: null }))}
        {form.rangeChoice === "custom" && <div className="scenario-dates"><div className="modal-field"><span>Start</span><DateField ariaLabel="Schedule start" value={form.from} min={today} onChange={from => set({ from, part: null })} /></div><div className="modal-field"><span>End</span><DateField ariaLabel="Schedule end" value={form.to} min={today} onChange={to => set({ to, part: null })} /></div></div>}
      </fieldset>}
      {horizon && !validHorizon && <p className="scenario-problem" role="alert">{horizonValid && !horizonValid.ok ? horizonValid.reason : "Choose valid dates."}</p>}
      {parts.length > 0 && <fieldset className="scenario-question"><legend>How should I count part months?</legend>
        {option("part", "Count only whole months", form.part === "exclude", () => set({ part: "exclude" }), whole ? "The dates will move to the complete months shown below." : "There is no whole month in this range.", !whole)}
        {option("part", "Count the part month by the day", form.part === "prorate", () => set({ part: "prorate" }), "Inclusive calendar days, using each month's actual length.")}
      </fieldset>}
      {resolvedHorizon && ready && <p className="scenario-banner">{scheduleText(intent as CutPreviewIntent)}</p>}
      {!check.ok && form.rows.length > 0 && <p className="scenario-secondary">{check.reason}</p>}
    </>, <button type="button" disabled={!ready} onClick={() => { if (ready) onChoices(structuredClone(intent) as CutPreviewIntent); }}>Review the details</button>);
  }

  if (screen.stage === "review") {
    const { scenario } = screen;
    const choices: ConfirmedCutPreview["baselines"] = [];
    const problems = new Map<string, string>();
    const validIntent = validateCutPreviewIntent(scenario.intent, { asOf: scenario.source.asOf, categories: scenario.intent.categories.map(c => c.category) });
    for (const row of scenario.baselines) {
      const choice = form.history[row.category], baseline = row.baseline;
      if (!sameScenarioSource(scenario.source, baseline.source) || scenarioBaselineProblem(baseline, false)) { problems.set(row.category, row.category + ": the source changed or history is incomplete. Refresh this preview."); continue; }
      let chosen: ScenarioBaseline | null = null;
      const count = countedMonths(baseline);
      if (choice?.kind === "manual") chosen = { kind: "manual", monthlyAmount: choice.amount.trim(), source: structuredClone(scenario.source) };
      else if (baseline.kind === "manual") chosen = structuredClone(baseline);
      else if (count === 3) chosen = structuredClone(baseline);
      else if (count > 0 && choice?.kind === "recorded") chosen = { ...structuredClone(baseline), shortHistoryAccepted: true };
      if (!chosen || scenarioBaselineProblem(chosen)) { problems.set(row.category, row.category + ": choose a valid usual month."); continue; }
      const term = scenario.intent.categories.find(c => c.category === row.category), monthly = scenarioMonthlyBaseline(chosen);
      if (validIntent.ok && term && monthly) {
        const [whole, part = ""] = term.monthlyFloor.split(".");
        const floor = BigInt(whole + part.padEnd(2, "0"));
        if (floor * BigInt(monthly.denominator) > BigInt(monthly.numerator) * 100n) problems.set(row.category, row.category + ": the monthly floor is above this usual month. Change the floor or usual month.");
      }
      choices.push({ category: row.category, baseline: chosen });
    }
    const ready = validIntent.ok && !problems.size && choices.length === scenario.intent.categories.length && new Set(choices.map(c => c.category)).size === choices.length && scenario.intent.categories.every(c => choices.some(b => b.category === c.category));
    const history = (category: string, patch: Partial<HistoryChoice>) => set({ history: { ...form.history, [category]: { ...(form.history[category] ?? { kind: null, amount: "" }), ...patch } } });
    return shell("Check every detail", <>
      <p className="scenario-banner">Nothing has been calculated yet. Check every selected category and choose how to handle any missing history. You can answer in either order.</p>
      <p><strong>Target: {typedDollars(scenario.intent.target.amount)} {scenario.intent.target.kind === "monthly" ? "per month" : "over these dates"}</strong><br />{scheduleText(scenario.intent)}</p>
      <p>Policy: spread the cuts in proportion to allowed capacity. Floors and maximum cuts stay as you choose them.</p>
      {scenario.baselines.map(row => {
        const term = scenario.intent.categories.find(c => c.category === row.category), baseline = row.baseline, count = countedMonths(baseline), choice = form.history[row.category];
        const manual = baseline.kind === "manual" || count === 0 || choice?.kind === "manual";
        const short = baseline.kind === "recorded" && count > 0 && count < 3;
        const usual = scenarioMonthlyBaseline(baseline);
        return <fieldset className="cut-preview-category scenario-question" key={row.category}><legend>{row.category}</legend>
          {term && <p>Monthly floor: {typedDollars(term.monthlyFloor)} · Maximum cut: {term.maximumReduction.kind === "money" ? typedDollars(term.maximumReduction.amount) + " per month" : term.maximumReduction.amount + "% of a usual month"}</p>}
          {baseline.kind === "recorded" ? <>
            <div className="modal-table-scroll"><table className="scenario-table"><caption>The last three full months of {row.category}</caption><thead><tr><th>Month</th><th className="amount-col">Spent</th><th>Used</th></tr></thead><tbody>{baselineRows(baseline).map(m => <tr key={m.month}><th scope="row">{m.month}</th><td className="amount-col">{m.spent}</td><td>{m.counted ? "Counted" : "Left out: " + m.reason}</td></tr>)}</tbody></table></div>
            {usual && <p>Usual month from {count} recorded {count === 1 ? "month" : "months"}: {money(usual)} (rounded).</p>}
            {count === 0 && <p>No complete months. Enter your own usual month or remove this category; missing records do not become $0.</p>}
          </> : <p>Your own usual month: {typedDollars(baseline.monthlyAmount)}, not checked against your records.</p>}
          {short && <fieldset className="scenario-question"><legend>Which usual month should I use for {row.category}?</legend>
            {option("history-" + row.category, "Use " + count + " recorded " + (count === 1 ? "month" : "months") + " for " + row.category, choice?.kind === "recorded", () => history(row.category, { kind: "recorded" }), "Less history may be less representative.")}
            {option("history-" + row.category, "Enter my own usual month for " + row.category, choice?.kind === "manual", () => history(row.category, { kind: "manual" }))}
          </fieldset>}
          {manual && <>{field(row.category + " usual month", choice?.amount ?? (baseline.kind === "manual" ? baseline.monthlyAmount : ""), amount => history(row.category, { kind: "manual", amount }), choice?.amount ? problems.get(row.category) : undefined)}<p className="scenario-secondary">Your own number, not checked against your records.</p></>}
          {problems.has(row.category) && <p className="scenario-problem">{problems.get(row.category)}</p>}
          <button type="button" className="scenario-link" onClick={() => onRemoveCategory(row.category)}>Remove {row.category}</button>
        </fieldset>;
      })}
      <p className="scenario-secondary">{COVERAGE_NOTE} All accounts and everyone in your household; as of {longDate(scenario.source.asOf)}.</p>
      <button type="button" className="modal-secondary" onClick={onEdit}>Change the details</button>
    </>, <button type="button" disabled={!ready} onClick={() => { if (ready) onConfirm(structuredClone({ ...scenario, baselines: choices, confirmed: true })); }}>Show the preview</button>);
  }

  if (screen.stage === "result") {
    const r = screen.calculation, intent = r.scenario.intent;
    const unit = r.unit === "per-month" ? "per month" : "over these dates";
    return shell("Your savings target preview", <>
      <div className="scenario-result" role="status"><p><strong>Goal: {cents(r.targetCents)} {unit}</strong></p><p>Achievable: {cents(r.allocatedCents)} {unit} · Maximum: {cents(r.maximumCents)} {unit}</p><p>Shortfall: {cents(r.shortfallCents)} {unit}{r.targetMet ? ". Your target fits these constraints." : ". This target cannot be met with these constraints."}</p><p className="scenario-total">{money(r.totalSaving)} across the selected dates</p><p>{scheduleText(intent)}</p>
        {intent.horizon.kind === "full-year-hypothetical" && <p>This whole-year what-if includes months that have already passed. It is not money you have already saved.</p>}
      </div>
      <p>Cuts are spread in proportion to allowed capacity, respecting each floor and maximum cut.</p>
      <div className="modal-table-scroll"><table className="scenario-table cut-preview-results"><caption>Every selected category</caption><thead><tr><th>Category</th><th className="amount-col">Allocated {unit}</th><th className="amount-col">{r.unit === "whole-period" ? "Approx. monthly cut" : "Monthly cut"}</th><th className="amount-col">Approx. monthly limit</th></tr></thead><tbody>{r.allocations.map(row => <tr key={row.category}><th scope="row">{row.category}</th><td className="amount-col">{cents(row.allocatedCents)}</td><td className="amount-col">{money(row.monthlyReduction)}</td><td className="amount-col">{money(row.monthlyLimit)}</td></tr>)}</tbody></table></div>
      <p className="scenario-secondary">Monthly equivalents and limits are rounded to cents. Use the allocated {unit} amounts; multiplying rounded monthly figures may not reproduce the exact total. Rounded lines may not add up exactly.</p>
      <details><summary>Category details and history</summary>{r.allocations.map(row => {
        const baseline = r.scenario.baselines.find(b => b.category === row.category)!.baseline;
        const term = intent.categories.find(c => c.category === row.category)!;
        return <section className="cut-preview-category" key={row.category}><h3>{row.category}</h3><p>Usual month: {money(row.monthlyBaseline)} (rounded); monthly floor: {typedDollars(term.monthlyFloor)}; maximum cut: {term.maximumReduction.kind === "money" ? typedDollars(term.maximumReduction.amount) : term.maximumReduction.amount + "%"}.</p><p>Maximum allowed capacity: {cents(row.capacityCents)} {unit}. Savings across dates: {money(row.totalSaving)}.</p>
          {baseline.kind === "manual" ? <p>You entered {typedDollars(baseline.monthlyAmount)} as a usual month; it was not checked against your records.</p> : <><p>Based on {countedMonths(baseline)} complete recorded {countedMonths(baseline) === 1 ? "month" : "months"}{countedMonths(baseline) < 3 ? ", which you chose to use" : ""}.</p><ul>{baselineRows(baseline).map(m => <li key={m.month}>{m.month}: {m.spent} — {m.counted ? "Counted" : "Left out: " + m.reason}</li>)}</ul></>}
          <ul>{row.intervals.map(i => <li key={i.from}>{longDate(i.from)} to {longDate(i.to)}: {money(i.saving)} (rounded)</li>)}</ul>
        </section>;
      })}</details>
      <p className="scenario-secondary">{COVERAGE_NOTE}</p><p className="scenario-caution">{CAUTION}</p>
    </>, <button type="button" onClick={onEdit}>Change the details</button>);
  }
  if (screen.stage === "reading") return shell("Reading spending records", <><p role="status">Reading {screen.categories.join(", ")}…</p><p>Nothing has been calculated yet.</p></>);
  if (screen.stage === "blocked") return shell("A few details need attention", <><p role="alert">Nothing was calculated.</p>{screen.calculation.kind === "needs-baseline" ? <p>Choose a usual month or remove: {screen.calculation.categories.join(", ")}.</p> : <ul>{screen.calculation.violations.map(v => <li key={v.category}>{v.category}: monthly floor {typedDollars(v.monthlyFloor)} is above the usual month {money(v.monthlyBaseline)} (rounded). Change the floor or usual month.</li>)}</ul>}</>, <button type="button" onClick={onEdit}>Change the details</button>);
  return shell(screen.stage === "stale" ? "Your records changed" : "I could not read those records", <><p className="scenario-banner" role="alert">{screen.message} Nothing was calculated.</p></>, <button type="button" onClick={onRestart}>Try again</button>);
}
