import { useState } from "react";
import { Check } from "lucide-react";

// "meadow-" is the app's earliest name, kept so a dismissed checklist stays dismissed (see themeBootstrap.ts).
const CHECKLIST_DISMISSED_KEY = "meadow-checklist-dismissed";

/** Same try/parse/catch-fallback shape as `loadNavOrder`/`theme` in
 * App.tsx — a per-viewer UI preference, not app data, so it lives in
 * localStorage rather than the database. */
function loadChecklistDismissed(): boolean {
  try {
    return localStorage.getItem(CHECKLIST_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export type ChecklistStep = { done: boolean; label: string; detail: string; onClick: () => void };

/** The "Get started" card. Remembers (per viewer, in browser storage) that it was dismissed, and hides itself once every step is done. */
export function FirstRunChecklist({ steps }: { steps: ChecklistStep[] }) {
  const [checklistDismissed, setChecklistDismissed] = useState(loadChecklistDismissed);

  function dismissChecklist() {
    setChecklistDismissed(true);
    try {
      localStorage.setItem(CHECKLIST_DISMISSED_KEY, "1");
    } catch {
      // per-viewer preference only — fine to skip if storage is unavailable
    }
  }

  if (checklistDismissed || !steps.some((s) => !s.done)) return null;
  return (
    <div className="card checklist-card">
      <div className="card-head">
        <span className="reports-section-title">Get started</span>
        <button type="button" className="status-dismiss" onClick={dismissChecklist} aria-label="Dismiss checklist">
          ×
        </button>
      </div>
      <ul className="checklist-list">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? "checklist-step checklist-step-done" : "checklist-step"}>
            <button type="button" className="checklist-step-btn" onClick={step.onClick} disabled={step.done}>
              <span className="checklist-step-check" aria-hidden="true">{step.done ? <Check /> : null}</span>
              <span className="checklist-step-text">
                <span className="checklist-step-label">{step.label}</span>
                <span className="checklist-step-detail">{step.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
