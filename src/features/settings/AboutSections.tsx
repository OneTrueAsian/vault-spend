import { versionsNewestFirst, changelogSections, CHANGELOG } from "../../shared/lib/changelog";
import { cardAttr, SettingStar } from "../../shared/ui/SettingStar";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ICON_CREDITS } from "../../shared/ui/icons";

/** Every released version's notes, newest first — the persistent
 * counterpart to `WhatsNewDialog` (App.tsx), which only ever shows the one
 * version a viewer just updated to, once, then never again. Reuses the
 * same `CHANGELOG` data (`changelog.ts`) rather than a second copy, so
 * cutting a release only ever means adding one entry there. The versions
 * are put newest first by number, not by where the entry sits in the file. */
export function ReleaseNotesSection({ currentVersion }: { currentVersion: string | null }) {
  const versions = versionsNewestFirst();
  if (versions.length === 0) return null;

  return (
    <div className="card" {...cardAttr("release-notes")}>
      <div className="card-head">
        <h2 className="reports-section-title">Release notes</h2>
        <SettingStar id="release-notes" />
      </div>
      <div className="release-notes-list">
        {versions.map((v, i) => (
          <details key={v} className="release-note-entry" open={i === 0}>
            <summary>
              <span>Version {v}</span>
              {v === currentVersion && <span className="release-note-current">Current</span>}
            </summary>
            {changelogSections(CHANGELOG[v]).map(({ heading, notes }) => (
              <section key={heading ?? ""}>
                {heading && <h3 className="modal-changelog-heading">{heading}</h3>}
                <ul className="modal-changelog-list">
                  {notes.map((note, j) => (
                    <li key={j}>{note}</li>
                  ))}
                </ul>
              </section>
            ))}
          </details>
        ))}
      </div>
    </div>
  );
}

/** Attribution for the bundled Noun Project icons (src/assets/icons/,
 * see icons/nounIcons.ts) used for several account, category, and bucket
 * icons — each one is licensed CC BY 3.0, which requires crediting the
 * work and its creator. */
export function IconCreditsSection() {
  return (
    <div className="card" {...cardAttr("icon-credits")}>
      <div className="card-head">
        <h2 className="reports-section-title">Icon credits</h2>
        <SettingStar id="icon-credits" />
      </div>
      <p className="modal-message-secondary">
        Several account, category, and goal icons are from The Noun Project, used under CC BY 3.0 — credited to
        their creators below.
      </p>
      <button
        type="button"
        className="modal-secondary"
        onClick={() => openUrl("https://creativecommons.org/licenses/by/3.0/")}
      >
        View CC BY 3.0 license →
      </button>
      <details className="icon-credits-disclosure" style={{ marginTop: 12 }}>
        <summary>Show all {ICON_CREDITS.length} credits</summary>
        <ul className="category-manage-list" style={{ marginTop: 12 }} tabIndex={0} aria-label="Icon credits">
          {ICON_CREDITS.map((c) => (
            <li key={c.name} className="category-manage-row">
              <span className="category-manage-name">
                {c.description} <span className="modal-message-secondary">(Noun Project ID {c.nounProjectId})</span>
              </span>
              <span className="account-col">{c.author}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Non-affiliation disclaimer — Vault Spend is an independent, unaffiliated
 * project, and given the crowded "vault"-themed naming space in personal
 * finance software, saying so plainly heads off any appearance of trading
 * on someone else's brand. */
export function AboutSection() {
  return (
    <div className="card" {...cardAttr("about")}>
      <div className="card-head">
        <h2 className="reports-section-title">About Vault Spend</h2>
        <SettingStar id="about" />
      </div>
      <p className="modal-message-secondary">Own your Data, Own your Money!</p>
      <p className="modal-message-secondary">
        Vault Spend is an independent open-source project and is not affiliated with, endorsed by, or partnered with
        any external financial services or wallet providers.
      </p>
    </div>
  );
}
