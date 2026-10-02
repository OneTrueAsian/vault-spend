import { useEffect, useId, useMemo, useState } from "react";
import { InfoTip } from "../InfoTip";
import { MenuSelect } from "../MenuSelect";
import { toLocalIsoDate } from "../format";
import type { Account, Asset, FamilyMember } from "../types";
import { AgeField } from "./AgeField";
import { AmountEditor } from "./AmountEditor";
import { FIELD_TIPS } from "./fieldTips";
import { getComparisonSetup, saveComparisonSetup, useGeneration } from "./api";
import { metricTitle, personLabel } from "./format";
import {
  allocationTotalBasisPoints,
  basisPointsToPercent,
  confirmBalances,
  emptySetup,
  percentToBasisPoints,
  personKey,
  setAge,
  setAllocation,
  setDebtClass,
  setDebtExcluded,
  setHouseholdIncomeMethod,
  setHouseholdTotal,
  setInHousehold,
  setInvestmentClass,
  setManualAnnualSpending,
  setManualOverride,
  setPersonIncome,
  setReferencePerson,
  setSavingsOverride,
  setSpendingAccount,
  setSpendingCompleteness,
  sourceKey,
  syncPeople,
} from "./setupDraft";
import "./Comparisons.css";
import type { ComparisonSetup, DebtClass, InvestmentClass, MetricId, Repair, SetupProblem, SourceRef } from "./types";

const INVESTMENT_CLASSES: { value: InvestmentClass | ""; label: string }[] = [
  { value: "", label: "Not chosen yet" },
  { value: "retirement", label: "Retirement" },
  { value: "taxable", label: "Taxable investment" },
  { value: "education", label: "Education" },
  { value: "other", label: "Other" },
  { value: "exclude", label: "Leave out" },
];

const DEBT_CLASSES: { value: DebtClass | ""; label: string }[] = [
  { value: "", label: "Default" },
  { value: "mortgage", label: "Mortgage" },
  { value: "credit_card", label: "Credit card" },
  { value: "student_loan", label: "Student loan" },
  { value: "vehicle", label: "Vehicle loan" },
  { value: "other", label: "Other debt" },
];

const SAVINGS_CHOICES = [
  { value: "default", label: "Default for this account type" },
  { value: "include", label: "Count as savings" },
  { value: "exclude", label: "Leave out" },
];

const MANUAL_HINT: Record<MetricId, string> = {
  income: "Warns when it is over a year old.",
  spending: "Warns when it is over a year old.",
  savings: "Warns when it is over 90 days old.",
  investments: "Warns when it is over 90 days old.",
  debt: "Warns when it is over 90 days old.",
};

function sameSource(a: SourceRef, b: SourceRef) {
  return sourceKey(a) === sourceKey(b);
}

function repairText(r: Repair, members: FamilyMember[]): string {
  return r.kind === "missing_person"
    ? `${personLabel(r.person, members)} is no longer in this profile (${r.field}).`
    : `A ${r.source.kind} (${r.field}) was deleted.`;
}

/** The "Your details" form inside Reports > Comparisons: whose age to
 * use, income, which accounts count, how they are classified, who owns shared accounts, confirmations
 * and typed totals. Edits are a draft: nothing is saved until Save, Discard throws the draft away, and
 * a save that lost a race or failed validation keeps everything typed. `onSaved` lets the page refresh
 * its cards at once; `knownRevision` is the setup revision the page last read, so a change made from a
 * card (a population or age-group choice) is picked up here unless there are unsaved edits. */
export function ComparisonDetailsPanel({
  accounts,
  assets,
  familyMembers,
  onSaved,
  knownRevision,
}: {
  accounts: Account[];
  assets: Asset[];
  familyMembers: FamilyMember[];
  onSaved?: () => void;
  knownRevision?: number;
}) {
  const generation = useGeneration();
  // Prefix for the ids that link a checkbox to its InfoTip.
  const uid = useId();
  const [base, setBase] = useState<ComparisonSetup | null>(null);
  const [revision, setRevision] = useState(0);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [draft, setDraft] = useState<ComparisonSetup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problems, setProblems] = useState<SetupProblem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const today = toLocalIsoDate();

  useEffect(() => {
    if (generation === null) return;
    let cancelled = false;
    getComparisonSetup(generation)
      .then((r) => {
        if (cancelled) return;
        setBase(r.setup);
        setDraft(r.setup ? syncPeople(r.setup, familyMembers) : null);
        setRevision(r.revision);
        setRepairs(r.repairs);
        setLoadError(null);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // familyMembers is read once per load; people added later are picked up by `syncPeople` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, reloadCount]);

  // A family member added elsewhere while this is open appears in the draft without disturbing other edits.
  useEffect(() => {
    setDraft((d) => (d ? syncPeople(d, familyMembers) : d));
  }, [familyMembers]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base ? syncPeople(base, familyMembers) : null), [draft, base, familyMembers]);
  const members = familyMembers;

  useEffect(() => {
    if (knownRevision !== undefined && loaded && knownRevision !== revision && !dirty) setReloadCount((n) => n + 1);
    // Only a new revision on the page should trigger this, not the panel's own state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownRevision]);

  function edit(change: (s: ComparisonSetup) => ComparisonSetup) {
    setMessage(null);
    setDraft((d) => (d ? change(d) : d));
  }

  async function save() {
    if (generation === null || !draft) return;
    setSaving(true);
    setProblems([]);
    setMessage(null);
    try {
      const r = await saveComparisonSetup(generation, revision, draft);
      if (r.status === "saved") {
        setBase(r.setup);
        setDraft(r.setup);
        setRevision(r.revision);
        setRepairs([]);
        setMessage("Saved.");
        onSaved?.();
      } else if (r.status === "conflict") {
        setMessage("These settings were changed somewhere else. Your edits are still here: review them and save again, or discard to reload.");
        setRevision(r.currentRevision);
      } else {
        setProblems(r.problems);
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setSaving(false);
    }
  }


  if (loadError) {
    return (
      <div className="card" data-cmp-settings>
        <p role="alert">Could not load comparison settings: {loadError}</p>
        <button type="button" className="modal-secondary" onClick={() => setReloadCount((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="card" data-cmp-settings>
        <p className="modal-message-secondary">Loading…</p>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="card" data-cmp-settings>
        <p className="modal-message-secondary">
          Comparisons line your finances up against published figures for people your age.
        </p>
        <button type="button" data-cmp-settings-start onClick={() => setDraft(syncPeople(emptySetup(), familyMembers))}>
          Set up comparisons
        </button>
      </div>
    );
  }

  const inHousehold = draft.people.filter((p) => p.inHousehold);
  const subject = draft.householdReferencePerson;

  const cashAccounts = accounts.filter((a) => ["checking", "savings", "other", "investment"].includes(a.account_type));
  const investmentSources: { source: SourceRef; name: string }[] = [
    ...accounts.filter((a) => a.account_type === "investment").map((a) => ({ source: { kind: "account", id: a.id } as SourceRef, name: a.name })),
    ...assets.map((a) => ({ source: { kind: "asset", id: a.id } as SourceRef, name: a.name })),
  ];
  const debtAccounts = accounts.filter((a) => a.account_type === "credit" || a.account_type === "loan");
  const spendingAccounts = accounts.filter((a) => ["checking", "savings", "credit"].includes(a.account_type));
  const shareable: { source: SourceRef; name: string }[] = [
    ...accounts.map((a) => ({ source: { kind: "account", id: a.id } as SourceRef, name: a.name })),
    ...assets.map((a) => ({ source: { kind: "asset", id: a.id } as SourceRef, name: a.name })),
  ];
  const savingsChoice = (a: Account) => {
    const o = draft.savingsOverrides.find((x) => sameSource(x.source, { kind: "account", id: a.id }));
    return o ? (o.include ? "include" : "exclude") : "default";
  };

  return (
    <div className="card" data-cmp-settings>
      <p className="modal-message-secondary">
        Your figures stay on this computer, in this profile only.
      </p>

      {repairs.length > 0 && (
        <div className="cmp-banner" role="status" data-cmp-settings-repairs>
          <div>
            <strong>Some saved details need attention.</strong>
            <ul>
              {repairs.map((r, i) => (
                <li key={i}>{repairText(r, members)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section className="cmp-settings-group" data-cmp-group="who">
        <h3>Who is compared</h3>
        <div className="cmp-settings-row">
          <span className="cmp-row-label">
            Age used for the household
            <InfoTip label="Age used for the household" text={FIELD_TIPS.subjectHousehold} />
          </span>
          <MenuSelect
            ariaLabel="Household reference person"
            value={subject ? personKey(subject) : ""}
            placeholder="Choose a person…"
            options={inHousehold.map((p) => ({ value: personKey(p.person), label: personLabel(p.person, members) }))}
            onChange={(key) => {
              const chosen = inHousehold.find((p) => personKey(p.person) === key);
              if (chosen) edit((s) => setReferencePerson(s, chosen.person));
            }}
          />
        </div>
        {draft.people.map((p) => (
          <div key={personKey(p.person)} className="cmp-person-row" data-cmp-person={personKey(p.person)}>
            <strong>{personLabel(p.person, members)}</strong>
            {p.person.kind !== "owner" && (
              <span className="cmp-tip-field">
                <label className="feature-toggle-row">
                  <input
                    type="checkbox"
                    checked={p.inHousehold}
                    aria-describedby={`${uid}-shares-${personKey(p.person)}`}
                    onChange={(e) => edit((s) => setInHousehold(s, p.person, e.target.checked))}
                  />
                  <span className="feature-toggle-text">Shares my finances (leave unticked for a roommate who manages their own money)</span>
                </label>
                <InfoTip label="Shares my finances" text={FIELD_TIPS.shares} id={`${uid}-shares-${personKey(p.person)}`} />
              </span>
            )}
            <AgeField
              label={`Age of ${personLabel(p.person, members)}`}
              value={p.age?.age ?? null}
              onChange={(age) => edit((s) => setAge(s, p.person, age, today))}
            />
            {p.age && <span className="modal-message-secondary">Age confirmed {p.age.confirmedOn}.</span>}
          </div>
        ))}
      </section>

      <section className="cmp-settings-group" data-cmp-group="income">
        <h3>Income (before tax)</h3>
        <p className="modal-message-secondary">
          Published income is before tax, so it is never estimated from your tracked take-home pay. Enter what you earn in a year.
        </p>
        <div className="cmp-settings-row">
          <span className="cmp-row-label">
            Enter income as
            <InfoTip label="Enter income as" text={FIELD_TIPS.incomeMethod} />
          </span>
          <MenuSelect
            ariaLabel="Household income method"
            value={draft.income.householdMethod}
            options={[
              { value: "total", label: "One household total" },
              { value: "by_person", label: "Separately for each person" },
            ]}
            onChange={(v) => edit((s) => setHouseholdIncomeMethod(s, v as "total" | "by_person"))}
          />
        </div>
        {draft.income.householdMethod === "total" ? (
          <AmountEditor
            key="household-total"
            label="Household income per year"
            value={draft.income.householdTotal}
            onChange={(a) => edit((s) => setHouseholdTotal(s, a))}
            hint="What you enter for each person is kept if you switch methods."
            tip={FIELD_TIPS.income}
          />
        ) : (
          inHousehold.map((p) => (
            <AmountEditor
              key={personKey(p.person)}
              label={`${personLabel(p.person, members)}: income per year`}
              tip={FIELD_TIPS.income}
              value={draft.income.perPerson.find((e) => personKey(e.person) === personKey(p.person))?.grossAnnual ?? null}
              onChange={(a) => edit((s) => setPersonIncome(s, p.person, a))}
            />
          ))
        )}
      </section>

      <section className="cmp-settings-group" data-cmp-group="spending">
        <h3>Spending</h3>
        <span className="cmp-tip-field">
          <label className="feature-toggle-row">
            <input
              type="checkbox"
              checked={draft.spending.completenessConfirmed}
              aria-describedby={`${uid}-spending-complete`}
              onChange={(e) => edit((s) => setSpendingCompleteness(s, e.target.checked))}
              data-cmp-spending-complete
            />
            <span className="feature-toggle-text">
              The last 12 completed months of tracked spending cover everything my household spends
            </span>
          </label>
          <InfoTip label="Spending covers everything" text={FIELD_TIPS.spendingComplete} id={`${uid}-spending-complete`} />
        </span>
        <fieldset className="cmp-members">
          <legend>
            Accounts that count (none ticked means all checking, savings and credit accounts)
            <InfoTip label="Accounts that count" text={FIELD_TIPS.spendingAccounts} />
          </legend>
          {spendingAccounts.map((a) => (
            <label key={a.id} className="feature-toggle-row">
              <input
                type="checkbox"
                checked={draft.spending.accountIds.includes(a.id)}
                onChange={(e) => edit((s) => setSpendingAccount(s, a.id, e.target.checked))}
              />
              <span className="feature-toggle-text">{a.name}</span>
            </label>
          ))}
        </fieldset>
        <AmountEditor
          label="Annual spending"
          value={draft.spending.manualAnnual}
          onChange={(a) => edit((s) => setManualAnnualSpending(s, a))}
          hint="Use this when there are fewer than 12 completed months of history. Short history is never scaled up automatically."
          tip={FIELD_TIPS.annualSpending}
        />
      </section>

      <section className="cmp-settings-group" data-cmp-group="savings">
        <h3>
          Savings
          <InfoTip label="Savings" text={FIELD_TIPS.savings} />
        </h3>
        <p className="modal-message-secondary">
          Checking and savings accounts count. Investment and “other” accounts are left out unless you count them; credit cards and loans never count.
        </p>
        {cashAccounts.map((a) => (
          <div key={a.id} className="cmp-settings-row">
            <span className="cmp-row-label">{a.name}</span>
            <MenuSelect
              ariaLabel={`${a.name}: savings`}
              value={savingsChoice(a)}
              options={SAVINGS_CHOICES}
              onChange={(v) => edit((s) => setSavingsOverride(s, { kind: "account", id: a.id }, v === "default" ? null : v === "include"))}
            />
          </div>
        ))}
      </section>

      <section className="cmp-settings-group" data-cmp-group="investments">
        <h3>
          Investments
          <InfoTip label="Investments" text={FIELD_TIPS.investments} />
        </h3>
        <p className="modal-message-secondary">Choose what each account or asset is, only for comparisons. It does not change anything elsewhere in the app.</p>
        {investmentSources.map(({ source, name }) => (
          <div key={sourceKey(source)} className="cmp-settings-row">
            <span className="cmp-row-label">{name}</span>
            <MenuSelect
              ariaLabel={`${name}: investment type`}
              value={draft.investmentClasses.find((c) => sameSource(c.source, source))?.class ?? ""}
              options={INVESTMENT_CLASSES}
              onChange={(v) => edit((s) => setInvestmentClass(s, source, v === "" ? null : (v as InvestmentClass)))}
            />
          </div>
        ))}
      </section>

      <section className="cmp-settings-group" data-cmp-group="debt">
        <h3>
          Debt
          <InfoTip label="Debt type" text={FIELD_TIPS.debtType} />
        </h3>
        <p className="modal-message-secondary">
          What you currently owe counts, including a card you normally pay in full. Leaving a card out here only changes the comparison.
        </p>
        {debtAccounts.map((a) => {
          const source: SourceRef = { kind: "account", id: a.id };
          return (
            <div key={a.id} className="cmp-settings-row">
              <span className="cmp-row-label">{a.name}</span>
              <MenuSelect
                ariaLabel={`${a.name}: type of debt`}
                value={draft.debtClasses.find((c) => sameSource(c.source, source))?.class ?? ""}
                options={DEBT_CLASSES}
                onChange={(v) => edit((s) => setDebtClass(s, source, v === "" ? null : (v as DebtClass)))}
              />
              <span className="cmp-tip-field">
                <label className="feature-toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.debtExclusions.some((x) => sameSource(x, source))}
                    aria-describedby={`${uid}-debt-out-${a.id}`}
                    onChange={(e) => edit((s) => setDebtExcluded(s, source, e.target.checked))}
                  />
                  <span className="feature-toggle-text">Leave out of the Debt comparison</span>
                </label>
                <InfoTip label="Leave out of the Debt comparison" text={FIELD_TIPS.debtLeaveOut} id={`${uid}-debt-out-${a.id}`} />
              </span>
            </div>
          );
        })}
      </section>

      {draft.people.length > 1 && (
        <section className="cmp-settings-group" data-cmp-group="shares">
          <h3>
            Shared accounts
            <InfoTip label="Shared accounts" text={FIELD_TIPS.accountShares} />
          </h3>
          <p className="modal-message-secondary">
            For an account or asset owned by more than one person, say what share is whose. A share that is not assigned is reported, never guessed. Leave it
            blank when one person owns all of it.
          </p>
          {shareable.map(({ source, name }) => {
            const total = allocationTotalBasisPoints(draft, source);
            return (
              <details key={sourceKey(source)} className="cmp-share-details" open={total > 0}>
                <summary>
                  {name}
                  {total > 0 && <span className="cmp-share"> · {basisPointsToPercent(total)}% assigned</span>}
                </summary>
                {draft.people.map((p) => {
                  const current = draft.allocations.find((a) => sameSource(a.source, source) && personKey(a.person) === personKey(p.person));
                  return (
                    <ShareInput
                      key={personKey(p.person)}
                      label={`${name}: share of ${personLabel(p.person, members)} (%)`}
                      person={personLabel(p.person, members)}
                      basisPoints={current?.basisPoints ?? 0}
                      onChange={(bp) => edit((s) => setAllocation(s, source, p.person, bp))}
                    />
                  );
                })}
              </details>
            );
          })}
        </section>
      )}

      <section className="cmp-settings-group" data-cmp-group="confirm">
        <h3>
          Confirm your balances
          <InfoTip label="Confirm your balances" text={FIELD_TIPS.confirmBalances} />
        </h3>
        <p className="modal-message-secondary">A balance comparison is only made once you say the accounts behind it are complete and current.</p>
        {(["savings", "investments", "debt"] as MetricId[]).map((m) => {
          const confirmed = draft.balanceConfirmations.find((c) => c.metric === m)?.confirmedOn;
          return (
            <div key={m} className="cmp-settings-row">
              <span className="cmp-row-label">{metricTitle(m)}</span>
              <button type="button" className="modal-secondary" data-cmp-confirm={m} onClick={() => edit((s) => confirmBalances(s, m, today))}>
                {confirmed ? "Confirm again today" : "Confirm these are complete and current"}
              </button>
              <span className="modal-message-secondary">{confirmed ? `Last confirmed ${confirmed}.` : "Not confirmed yet."}</span>
            </div>
          );
        })}
      </section>

      <section className="cmp-settings-group" data-cmp-group="manual">
        <h3>Enter a total yourself</h3>
        <p className="modal-message-secondary">
          Leave these empty and Vault Spend works out each total from your accounts. Type an amount only if the app&apos;s total would be wrong, for
          example because you have an account you have not added. The app&apos;s own total is still shown in the details.
        </p>
        {(["savings", "investments", "debt", "spending"] as const)
          .map((m) => (
            <AmountEditor
              key={m}
              label={`${metricTitle(m)}: your own total`}
              value={draft.manualOverrides.find((o) => o.metric === m)?.amount ?? null}
              onChange={(a) => edit((s) => setManualOverride(s, m, a))}
              hint={MANUAL_HINT[m]}
              tip={FIELD_TIPS.manualTotal[m]}
            />
          ))}
      </section>

      {problems.length > 0 && (
        <div className="cmp-banner cmp-banner-error" role="alert" data-cmp-problems>
          <div>
            <strong>These need fixing before it can be saved:</strong>
            <ul>
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {message && (
        <p className="modal-message-secondary" role="status" data-cmp-settings-message>
          {message}
        </p>
      )}
      <div className="cmp-settings-actions">
        <button type="button" onClick={save} disabled={!dirty || saving} data-cmp-settings-save>
          Save
        </button>
        <button
          type="button"
          className="modal-secondary"
          disabled={!dirty || saving}
          data-cmp-settings-discard
          onClick={() => {
            setProblems([]);
            setMessage(null);
            if (base) setDraft(syncPeople(base, familyMembers));
            else setDraft(null);
          }}
        >
          Discard changes
        </button>
      </div>
    </div>
  );
}

/** One person's percentage share. Blank or 0 removes the share; an invalid entry waits until fixed. */
function ShareInput({ label, person, basisPoints, onChange }: { label: string; person: string; basisPoints: number; onChange: (bp: number) => void }) {
  const [text, setText] = useState(basisPoints > 0 ? basisPointsToPercent(basisPoints) : "");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="cmp-settings-row cmp-share-row">
      <span className="cmp-row-label">{person}</span>
      <input
        type="text"
        inputMode="decimal"
        className="cmp-age-input"
        aria-label={label}
        aria-invalid={error !== null}
        value={text}
        placeholder="%"
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === "") {
            setError(null);
            onChange(0);
            return;
          }
          const parsed = percentToBasisPoints(e.target.value);
          if ("error" in parsed) setError(parsed.error);
          else {
            setError(null);
            onChange(parsed.ok);
          }
        }}
      />
      {error && (
        <span className="cmp-field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
