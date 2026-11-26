import { createContext, ReactNode, useState, useRef, useEffect, useContext } from "react";
import { splitErrorDetail } from "../lib/errorMessage";

/** The result of an action, shown in the card whose button was clicked. The app still shows its message at the bottom
 * of the window; this copy sits beside the control and is announced to assistive technology. */
type CardFeedback = { owner: string; text: string; kind: string };

const CardFeedbackContext = createContext<{ shown: CardFeedback | null; begin: (owner: string) => void } | null>(null);

export function CardFeedbackProvider({ status, children }: { status: { text: string; kind: string } | null; children: ReactNode }) {
  const [shown, setShown] = useState<CardFeedback | null>(null);
  const waiting = useRef<string | null>(null);
  const seen = useRef(status);
  useEffect(() => {
    if (status === seen.current) return;
    seen.current = status;
    if (!status || !waiting.current) return;
    // The plain words only: a failure's technical cause stays behind Details in the status line (VS-71).
    setShown({ owner: waiting.current, kind: status.kind, text: splitErrorDetail(status.text).message });
    waiting.current = null;
  }, [status]);
  const begin = (owner: string) => {
    waiting.current = owner;
    setShown(null);
  };
  return <CardFeedbackContext.Provider value={{ shown, begin }}>{children}</CardFeedbackContext.Provider>;
}

/** `begin()` marks the card as waiting for its action's result; `<Feedback />` shows it. */
export function useCardFeedback(owner: string) {
  const context = useContext(CardFeedbackContext);
  const mine = context?.shown?.owner === owner ? context.shown : null;
  return { begin: () => context?.begin(owner), text: mine?.text ?? "", kind: mine?.kind ?? "" };
}

export function Feedback({ text, kind }: { text: string; kind: string }) {
  return (
    <span role="status" className={`settings-feedback${kind === "error" ? " settings-feedback-error" : ""}`}>
      {text}
    </span>
  );
}
