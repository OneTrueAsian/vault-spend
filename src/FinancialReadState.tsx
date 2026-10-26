export function FinancialReadState({
  label,
  initial,
  loading,
  error,
  onRetry,
}: {
  label: string;
  initial: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (!loading && !error) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`status ${error ? "status-error" : "status-info"}`}
      data-financial-read={label}
    >
      <span className="status-text">
        {error
          ? `${initial ? `${label} could not be loaded.` : `Showing the last loaded ${label.toLowerCase()}; refresh failed.`} ${error}`
          : `${initial ? "Loading" : "Refreshing"} ${label.toLowerCase()}…`}
      </span>
      {error && (
        <button className="status-action" type="button" onClick={onRetry}>
          Retry loading totals
        </button>
      )}
    </div>
  );
}
