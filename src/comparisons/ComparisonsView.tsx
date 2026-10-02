import { useCallback, useEffect, useRef, useState } from "react";
import type { Account, Asset, FamilyMember, Transaction } from "../types";
import { ComparisonCard } from "./ComparisonCard";
import { ComparisonDetailsDialog } from "./ComparisonDetailsDialog";
import { ComparisonDetailsPanel } from "./ComparisonDetailsPanel";
import { ComparisonSetupDialog } from "./ComparisonSetupDialog";
import { getComparisonSetup, getComparisons, saveComparisonSetup, useGeneration } from "./api";
import { setCohortChoice, setUniversePreference } from "./setupDraft";
import type { ComparisonSetup, ComparisonsResponse, MetricId, Universe } from "./types";
import "./Comparisons.css";

interface Loaded {
  response: ComparisonsResponse;
  setup: ComparisonSetup | null;
  revision: number;
}

/** Reports > Comparisons. Reads the five cards from one backend call, so they always describe the
 * same moment of the ledger. It reloads whenever the page is shown again and whenever the data it
 * depends on changes, never shows zero-valued placeholder cards while loading, and drops nothing but
 * the cards that are only waiting for the person's own input. The "Your details" panel under the cards
 * holds everything the person enters (mode, ages, income, accounts, totals); it opens by itself when a
 * card is waiting for details, and saving it refreshes the cards. */
export function ComparisonsView({
  active = true,
  accounts,
  transactions,
  assets,
  familyMembers,
}: {
  active?: boolean;
  accounts?: Account[];
  transactions?: Transaction[];
  assets?: Asset[];
  familyMembers?: FamilyMember[];
}) {
  const generation = useGeneration();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [exploring, setExploring] = useState<MetricId | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const requestId = useRef(0);
  const members = familyMembers ?? [];

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    if (generation === null || !active) return;
    const id = ++requestId.current;
    Promise.all([getComparisons(generation), getComparisonSetup(generation)])
      .then(([response, setup]) => {
        if (id !== requestId.current) return;
        // The two reads are separate calls; if the setup moved between them, read again.
        if (setup.revision !== response.setupRevision) {
          refresh();
          return;
        }
        setError(null);
        setLoaded({ response, setup: setup.setup, revision: setup.revision });
      })
      .catch((reason) => {
        if (id === requestId.current) setError(String(reason));
      });
    // The ledger props are refetch triggers: App replaces them after every relevant change.
  }, [generation, active, reload, accounts, transactions, assets, familyMembers, refresh]);

  async function patchSetup(change: (s: ComparisonSetup) => ComparisonSetup) {
    if (generation === null || !loaded?.setup) return;
    setNotice(null);
    try {
      const response = await saveComparisonSetup(generation, loaded.revision, change(loaded.setup));
      if (response.status === "conflict") setNotice("Your comparison settings changed somewhere else, so this page was refreshed. Try again.");
      if (response.status === "invalid") setNotice(response.problems.map((p) => p.message).join(" "));
    } catch (reason) {
      setNotice(String(reason));
    }
    refresh();
  }

  const report = loaded?.response.report ?? null;
  const visible = report?.cards.filter((c) => c.visible) ?? [];
  const hiddenCount = (report?.cards.length ?? 0) - visible.length;
  const exploringCard = report?.cards.find((c) => c.result.metric === exploring) ?? null;
  const configured = loaded?.response.configured ?? false;

  // Decide once, on the first read of a configured setup (so also right after first-use setup), whether
  // the panel starts open: only when a card is waiting for details.
  useEffect(() => {
    if (loaded && configured && detailsOpen === null) setDetailsOpen(hiddenCount > 0);
  }, [loaded, detailsOpen, configured, hiddenCount]);

  function showDetails() {
    setDetailsOpen(true);
    detailsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="cmp-page" data-comparisons-page>
      {error && (
        <div className="cmp-banner cmp-banner-error" role="alert" data-cmp-error>
          <span>Could not load comparisons: {error}</span>
          <button type="button" className="modal-secondary" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {notice && (
        <div className="cmp-banner" role="status">
          {notice}
        </div>
      )}

      {loaded === null && !error && (
        <p className="cmp-loading" data-cmp-loading role="status">
          Loading comparisons…
        </p>
      )}

      {loaded && !loaded.response.configured && (
        <section className="cmp-empty" data-cmp-unconfigured>
          <h2>Compare your finances with people your age</h2>
          <p>
            Tell Vault Spend how old you are and it will line up your income, savings, investments and debt against published figures from public sources,
            showing exactly which group each figure describes. Nothing leaves this computer.
          </p>
          <button type="button" onClick={() => setSettingUp(true)} disabled={generation === null} data-cmp-start-setup>
            Set up comparisons
          </button>
        </section>
      )}

      {loaded?.response.packageError && (
        <div className="cmp-banner cmp-banner-error" role="alert" data-cmp-package-error>
          The published benchmark data could not be loaded, so nothing can be compared right now. Your settings are untouched.
        </div>
      )}

      {loaded && loaded.response.repairs.length > 0 && (
        <div className="cmp-banner" role="status" data-cmp-repairs>
          Some saved details refer to people or accounts that were deleted. Those inputs are ignored until you fix them.{" "}
          <button type="button" className="modal-secondary" onClick={showDetails}>
            Open your details
          </button>
        </div>
      )}

      {report && (
        <>
          <div className="cmp-grid" data-cmp-grid>
            {visible.map((view) => (
              <ComparisonCard
                key={view.result.metric}
                view={view}
                onExplore={() => setExploring(view.result.metric)}
                onChooseUniverse={(u: Universe) => void patchSetup((s) => setUniversePreference(s, view.result.metric, u))}
                onChooseCohort={(id) => void patchSetup((s) => setCohortChoice(s, view.result.metric, id))}
              />
            ))}
          </div>
          {visible.length === 0 && loaded?.response.configured && (
            <p className="cmp-hint" data-cmp-nothing-yet>
              Nothing can be compared yet.
            </p>
          )}
          {hiddenCount > 0 && (
            <p className="cmp-hint" data-cmp-hidden-note>
              {hiddenCount === 1 ? "One comparison is" : `${hiddenCount} comparisons are`} hidden until you add the details it needs.{" "}
              <button type="button" className="modal-secondary" onClick={showDetails}>
                Show your details
              </button>
            </p>
          )}
          <p className="cmp-footnote">
            Published figures come from public surveys (reference data {report.packageVersion}) and are adjusted for inflation. Calculated on this
            computer.
          </p>
        </>
      )}

      {configured && (
        <section className="cmp-details" data-cmp-details-panel ref={detailsRef}>
          <button
            type="button"
            className="cmp-details-toggle"
            data-cmp-details-toggle
            aria-expanded={detailsOpen === true}
            aria-controls="cmp-details-body"
            onClick={() => setDetailsOpen(detailsOpen !== true)}
          >
            <span className="cmp-details-caret" aria-hidden="true">
              {detailsOpen === true ? "▾" : "▸"}
            </span>
            Your details
          </button>
          <div id="cmp-details-body" data-cmp-details-body hidden={detailsOpen !== true}>
            <ComparisonDetailsPanel
              accounts={accounts ?? []}
              assets={assets ?? []}
              familyMembers={members}
              knownRevision={loaded?.revision}
              onSaved={refresh}
            />
          </div>
        </section>
      )}

      {exploringCard && <ComparisonDetailsDialog view={exploringCard} onClose={() => setExploring(null)} />}
      {settingUp && generation !== null && (
        <ComparisonSetupDialog
          generation={generation}
          members={members}
          onCancel={() => setSettingUp(false)}
          onSaved={() => {
            setSettingUp(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
