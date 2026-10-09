export function TransactionReadState({ initial, loading, error, onRetry }: {
  initial: boolean; loading: boolean; error: string | null; onRetry: () => void;
}) {
  if (!error && !loading) return null;
  if (!error) return <p role="status" className="status status-info" data-transaction-refresh><span className="status-text">Refreshing financial data…</span></p>;
  return <div role="alert" data-transaction-read-error className="status status-error">
    <span className="status-text">{initial ? "Your financial data could not be loaded." : "Showing the last loaded data; it could not be refreshed."} {error}</span>
    <button type="button" className="status-action" onClick={onRetry}>Retry loading data</button>
  </div>;
}
