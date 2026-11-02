import { ReactNode, useState } from "react";

/** A one-line summary's longer explanation, behind a labelled link: a page stays short and nothing is lost. */
export function MoreInfo({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="settings-more" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Less" : "More about this"}
      </button>
      {open && <span className="settings-more-text">{children}</span>}
    </>
  );
}
