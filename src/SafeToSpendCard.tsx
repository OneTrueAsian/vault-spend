import { useEffect, useMemo, useState } from "react";
import type { BillAwareForecast } from "./types";
import { formatAmount, formatDisplayDate, toLocalIsoDate } from "./format";
import { safeToSpend } from "./safeToSpend";
import { getCurrentGeneration, getProfileUiState, setProfileUiState } from "./profileUiState";

function parseBuffer(stored: string | null): number {
  const parsed = parseFloat(stored ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function loadBuffer(): Promise<number> {
  try {
    return parseBuffer(await getProfileUiState("safe_to_spend_buffer"));
  } catch {
    return 0; // unavailable/corrupt value — just no buffer
  }
}

async function saveBuffer(value: number) {
  try {
    const generation = await getCurrentGeneration();
    await setProfileUiState("safe_to_spend_buffer", String(value), generation);
  } catch {
    // a failed write only means the buffer isn't remembered next launch
  }
}

/** Dashboard widget: "how much can I spend on everyday things until I get
 * paid?" — cash now, minus every Recurring bill due before the next
 * paycheck, minus an optional buffer the user chooses to keep (remembered
 * per viewer, like the theme). All the arithmetic is `safeToSpend`; this
 * only lays it out. */
export function SafeToSpendCard({
  forecast,
  onOpenRecurring,
}: {
  forecast: BillAwareForecast;
  onOpenRecurring: () => void;
}) {
  const [bufferText, setBufferText] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadBuffer().then((saved) => {
      if (!cancelled && saved > 0) setBufferText(String(saved));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const buffer = Math.max(0, parseFloat(bufferText) || 0);

  function changeBuffer(text: string) {
    setBufferText(text);
    saveBuffer(Math.max(0, parseFloat(text) || 0));
  }

  const cash = parseFloat(forecast.start_balance);
  const result = useMemo(
    () => safeToSpend({ cash, events: forecast.events, today: toLocalIsoDate(new Date()), buffer }),
    [cash, forecast.events, buffer],
  );

  if (!forecast.uses_recurring) {
    return (
      <div className="card safe-to-spend-card" data-safe-to-spend="unavailable">
        <div className="card-head">
          <span className="reports-section-title">Safe to spend</span>
        </div>
        <p className="modal-message-secondary">
          Add your bills and paycheck to Recurring and this will show how much you can spend before you're next paid.
        </p>
        <button type="button" className="modal-secondary" onClick={onOpenRecurring}>
          Open Recurring
        </button>
      </div>
    );
  }

  const billsTotal = result.bills.reduce((sum, b) => sum + Math.abs(parseFloat(b.amount)), 0);
  return (
    <div className="card safe-to-spend-card" data-safe-to-spend={result.amount < 0 ? "negative" : "positive"}>
      <div className="card-head">
        <span className="reports-section-title">Safe to spend</span>
      </div>
      <p className={result.amount < 0 ? "safe-amount safe-amount-negative" : "safe-amount"}>
        {formatAmount(result.amount.toFixed(2))}
      </p>
      <p className="modal-message-secondary">
        {result.nextIncome
          ? `until ${result.nextIncome.label} on ${formatDisplayDate(result.nextIncome.date)} (${result.daysUntilPayday} day${result.daysUntilPayday === 1 ? "" : "s"})`
          : "after every bill in the next 45 days — no paycheck is on your Recurring list"}
        {result.perDay !== null && ` · about ${formatAmount(result.perDay.toFixed(2))} a day`}
      </p>
      <p className="modal-message-secondary">
        {formatAmount(cash.toFixed(2))} in cash − {formatAmount(billsTotal.toFixed(2))} of{" "}
        {result.bills.length} bill{result.bills.length === 1 ? "" : "s"} due before then
        {buffer > 0 && ` − ${formatAmount(buffer.toFixed(2))} buffer`}
      </p>
      <label className="safe-buffer">
        Keep a buffer of $
        <input
          className="text-input"
          inputMode="decimal"
          value={bufferText}
          onChange={(e) => changeBuffer(e.target.value)}
          placeholder="0"
          aria-label="Buffer to keep"
        />
      </label>
    </div>
  );
}
