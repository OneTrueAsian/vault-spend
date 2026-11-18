import "./Modal.css";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
/** The dialogs that are modal. A date or month calendar is a non-modal dialog inside its field; it must not
 * count as "the uppermost dialog", or the dialog around it would stop trapping Tab and handling Escape. */
const MODAL_DIALOG = '[role="dialog"][aria-modal="true"]';

/** What Tab can actually reach in a dialog: enabled controls that are in the tab order and not hidden. */
function tabbableWithin(panel: HTMLElement): HTMLElement[] {
  return [
    ...panel.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], [tabindex]',
    ),
  ].filter((el) => {
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled) return false;
    if (el instanceof HTMLInputElement && el.type === "hidden") return false;
    if (el.closest("[hidden], [inert]")) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

/** Shared shell: a dimmed overlay behind a centered panel. Clicking the
 * overlay (not the panel) cancels, matching how a native dialog behaves —
 * Escape does too, and focus moves onto the panel on open, since every
 * dialog in the app goes through this one component (fixing it here fixes
 * all of them, rather than needing this in each of the ~20 dialogs below).
 * Tab/Shift+Tab are trapped within the panel while it's open, and focus is
 * restored to whatever had it beforehand once the dialog closes — without
 * this, a keyboard or screen-reader user could Tab straight out of any
 * dialog into the sidebar behind the overlay. */
export function ModalShell({
  title,
  onCancel,
  children,
  wide,
  headerAction,
  footer,
  dismissOnOverlayClick = true,
  panelAttrs,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
  /** Content-heavy dialogs (a scrollable list, a table) need more room than
   * a plain form does — pass `wide` rather than growing every modal. */
  wide?: boolean;
  /** Something for the top right of the header row (a Close button). */
  headerAction?: React.ReactNode;
  /** Pins these controls below a body that scrolls on its own: the header and
   * the footer stay on screen however small the window or long the content. */
  footer?: React.ReactNode;
  /** A click outside the panel cancels it. Pass `false` for a dialog holding work a stray click
   * shouldn't throw away (an import review); Escape still cancels. */
  dismissOnOverlayClick?: boolean;
  /** Extra attributes for the dialog panel, e.g. a `data-*` hook that tests rely on. */
  panelAttrs?: Record<string, string | number | boolean | undefined>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Captured at construction time, before the panel (or any descendant
  // `autoFocus` input) takes focus — reading `document.activeElement`
  // inside the effect below would be too late, since React has already
  // applied `autoFocus` by the time an effect runs.
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  // `onCancel` is a fresh inline closure from the caller on every render of
  // *their* component (not this one) — if it were a dependency below, any
  // unrelated re-render of the caller while the dialog is open would fire
  // this effect's cleanup (restoring focus to whatever was focused before
  // the dialog opened) and then immediately re-run the mount logic, which
  // steals focus back onto the inert panel instead of the field the caller
  // put `autoFocus` on. Reading it via a ref keeps the effect itself tied
  // only to the dialog's own mount/unmount.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  // In dev (`tauri dev`'s Vite dev server), `<StrictMode>` in main.tsx
  // deliberately double-invokes every effect on mount — setup, cleanup,
  // setup again — to surface exactly this kind of bug. Production builds
  // (what the e2e suite drives) don't do this, which is why this only
  // shows up when running against the dev server. Tracking any pending
  // restore-focus call here, so a setup re-run can cancel it, is what
  // makes the sequence below a no-op instead of stealing focus.
  const pendingRestoreRef = useRef<number | null>(null);

  // When the focused control disappears or is disabled on a step change (a wizard's Continue becoming the next step's button), the browser drops focus
  // to <body>, behind the overlay, until the next Tab. After any render, bring focus back to the panel if that happened and this is the uppermost dialog.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const dialogs = document.querySelectorAll(MODAL_DIALOG);
    if (dialogs[dialogs.length - 1] === panelRef.current) panelRef.current?.focus();
  });

  useEffect(() => {
    // Captured once when the dialog opened (the ref is never reassigned); read here so the deferred
    // restore below focuses that element.
    const previouslyFocused = previouslyFocusedRef.current;
    if (pendingRestoreRef.current !== null) {
      clearTimeout(pendingRestoreRef.current);
      pendingRestoreRef.current = null;
    }
    // Several dialogs have their own `autoFocus` input, which — being a
    // descendant — mounts and claims focus before this effect runs; only
    // take focus here if nothing inside the panel already has it, so this
    // doesn't yank focus away from that input back onto the inert panel.
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
    function onKeyDown(e: KeyboardEvent) {
      // A manual-lock confirmation can cover another dialog containing unsaved work. Only the
      // uppermost dialog handles Escape and traps Tab; cancelling it must preserve the draft below.
      const dialogs = document.querySelectorAll(MODAL_DIALOG);
      if (dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (e.key === "Escape") {
        // A date or month calendar open inside the dialog consumes its own Escape (it prevents the default).
        if (e.defaultPrevented) return;
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // A basic focus trap: Tab/Shift+Tab cycle within the dialog's own
      // focusable elements instead of leaking into the page behind the
      // overlay — queried fresh on every press since a dialog's own
      // contents can change while it's open (a field appearing/disabling).
      const focusable = tabbableWithin(panelRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const atEdgeOrOutside = e.shiftKey
        ? active === first || !panelRef.current.contains(active)
        : active === last || !panelRef.current.contains(active);
      if (atEdgeOrOutside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Deferred rather than called inline: an inline call here would
      // fire on StrictMode's simulated dev-only cleanup too, moving
      // focus off the dialog's autoFocus field a tick before the setup
      // above re-runs and — finding focus outside the panel — grabs it
      // onto the inert panel div instead, permanently losing the
      // autoFocus target even though the dialog never really closed.
      // Scheduling it lets that re-run's `clearTimeout` above cancel it
      // first on a false alarm; on a real close there's no re-run to
      // cancel it, so it still fires, just one tick later.
      pendingRestoreRef.current = window.setTimeout(() => {
        pendingRestoreRef.current = null;
        previouslyFocused?.focus();
      }, 0);
    };
    // Mount/unmount only — see the comment on `onCancelRef` above.
  }, []);

  // Rendered into <body>, not where it's used: a dialog is `position: fixed`,
  // and any filtered ancestor (the Transparent style's `backdrop-filter` on
  // `.page`) becomes its containing block — laying it out against the whole
  // scrolled page instead of the window, so it could sit mostly off-screen.
  return createPortal(
    <div className="modal-overlay" onClick={dismissOnOverlayClick ? onCancel : undefined}>
      <div
        ref={panelRef}
        className={["modal-panel", wide ? "modal-panel-wide" : "", footer ? "modal-panel-fixed-chrome" : ""].filter(Boolean).join(" ")}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        {...panelAttrs}
      >
        {headerAction ? (
          <div className="modal-header">
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {headerAction}
          </div>
        ) : (
          <h2 className="modal-title" id={titleId}>
            {title}
          </h2>
        )}
        {footer ? (
          <>
            <div className="modal-body">{children}</div>
            <div className="modal-footer">{footer}</div>
          </>
        ) : (
          children
        )}
      </div>
    </div>,
    document.body,
  );
}

