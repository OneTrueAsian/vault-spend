/** Questions Ask the Vault can always take, offered when a what-if or savings-target question could not be answered. */
export const TRY_INSTEAD = ["Where can I save money in my budget?", "What can I cut back on?", "What if I cut Groceries by $50 a month?"] as const;

export function TryInstead({ onTry }: { onTry: (question: string) => void }) {
  return (
    <div className="ledger-qa-try-instead" data-try-instead>
      <p className="modal-message-secondary">Try one of these instead:</p>
      <ul className="ledger-qa-examples">
        {TRY_INSTEAD.map(question => (
          <li key={question}>
            <button type="button" onClick={() => onTry(question)}>{question}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
