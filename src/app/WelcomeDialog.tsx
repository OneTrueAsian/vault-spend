import { ModalShell } from "../shared/ui/Modal";

export function WelcomeDialog({
  onExploreHelp,
  onGetStarted,
}: {
  onExploreHelp: () => void;
  onGetStarted: () => void;
}) {
  return (
    <ModalShell title="Welcome to Vault Spend" onCancel={onGetStarted}>
      <p className="modal-message">
        Own your Data, Own your Money! Before you dive in, would you like a quick
        tour of how everything works?
      </p>
      <p className="modal-message modal-message-secondary">
        You can always come back to this from the Help tab in the sidebar.
      </p>
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onGetStarted}>
          Just get started
        </button>
        <button type="button" onClick={onExploreHelp}>
          Explore Help
        </button>
      </div>
    </ModalShell>
  );
}
