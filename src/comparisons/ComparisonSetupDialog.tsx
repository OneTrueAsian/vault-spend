import { useMemo, useState } from "react";
import { InfoTip } from "../InfoTip";
import { MenuSelect } from "../MenuSelect";
import { FIELD_TIPS } from "./fieldTips";
import { ModalShell } from "../Modal";
import { toLocalIsoDate } from "../format";
import { AgeField } from "./AgeField";
import { saveComparisonSetup } from "./api";
import { personLabel } from "./format";
import { emptySetup, personKey, setAge, setInHousehold, setReferencePerson, syncPeople } from "./setupDraft";
import type { AgeInput, ComparisonSetup, PersonRef } from "./types";

type Member = { id: number; name: string };

/** The light first-use setup: whose age to use, and who shares the finances.
 * Everything else (income, accounts, classifications, shares) is configured under Settings >
 * Comparisons. Nothing is saved until Save; Cancel discards the draft. */
export function ComparisonSetupDialog({
  generation,
  members,
  onSaved,
  onCancel,
}: {
  generation: number;
  members: Member[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [subjectKey, setSubjectKey] = useState("owner");
  const [outsiders, setOutsiders] = useState<Set<number>>(new Set());
  const [age, setAgeState] = useState<AgeInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const everyone: PersonRef[] = useMemo(() => [{ kind: "owner" }, ...members.map((m): PersonRef => ({ kind: "member", id: m.id }))], [members]);
  const inHousehold = everyone.filter((p) => p.kind === "owner" || !outsiders.has(p.id));
  const choices = inHousehold;
  const subject = choices.find((p) => personKey(p) === subjectKey) ?? choices[0];

  function build(): ComparisonSetup {
    let draft = syncPeople(emptySetup(), members);
    for (const id of outsiders) draft = setInHousehold(draft, { kind: "member", id }, false);
    draft = setReferencePerson(draft, subject);
    return age ? setAge(draft, subject, age, toLocalIsoDate()) : draft;
  }

  async function save() {
    if (!age) {
      setError("Enter an age or an age range so there is something to compare with.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await saveComparisonSetup(generation, 0, build());
      if (response.status === "saved") {
        onSaved();
        return;
      }
      setError(
        response.status === "conflict"
          ? "Comparisons were already set up on this profile. Close this and reopen the page."
          : response.problems.map((p) => p.message).join(" "),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title="Set up comparisons"
      onCancel={onCancel}
      footer={
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} data-cmp-setup-save>
            Save
          </button>
        </div>
      }
    >
      <div className="cmp-setup" data-cmp-setup>
        <p className="modal-message-secondary">
          Compare your finances with published figures for people your age. Your numbers stay on this computer. You can fill in the rest under Settings →
          Comparisons.
        </p>
        {error && (
          <p className="launch-error-problem" role="alert">
            {error}
          </p>
        )}

        {members.length > 0 && (
          <fieldset className="cmp-members">
            <legend>
              Who shares your finances?
              <InfoTip label="Who shares your finances?" text={FIELD_TIPS.shares} />
            </legend>
            <p className="modal-message-secondary">
              Leave out anyone who lives with you but manages their own money, such as a roommate.
            </p>
            <label className="feature-toggle-row">
              <input type="checkbox" checked disabled />
              <span className="feature-toggle-text">Me</span>
            </label>
            {members.map((m) => (
              <label key={m.id} className="feature-toggle-row">
                <input
                  type="checkbox"
                  checked={!outsiders.has(m.id)}
                  onChange={(e) =>
                    setOutsiders((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.delete(m.id);
                      else next.add(m.id);
                      return next;
                    })
                  }
                />
                <span className="feature-toggle-text">{m.name}</span>
              </label>
            ))}
          </fieldset>
        )}

        {choices.length > 1 && (
          <div className="modal-field">
            <span>
              Whose age should we use?
              <InfoTip label="Whose age should we use?" text={FIELD_TIPS.subjectHousehold} />
            </span>
            <MenuSelect
              ariaLabel="Reference person"
              fill
              value={personKey(subject)}
              options={choices.map((p) => ({ value: personKey(p), label: personLabel(p, members) }))}
              onChange={(key) => {
                setSubjectKey(key);
                setAgeState(null);
              }}
            />
          </div>
        )}

        <AgeField key={personKey(subject)} label={`Age of ${personLabel(subject, members) === "Me" ? "me" : personLabel(subject, members)}`} value={age} onChange={setAgeState} />
        <p className="modal-message-secondary">
          Only the age is stored, with the date you confirmed it. Different figures use different published age groups, and each card shows the group it
          used.
        </p>
      </div>
    </ModalShell>
  );
}
