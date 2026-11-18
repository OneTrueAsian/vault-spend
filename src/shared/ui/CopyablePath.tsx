import { useState, useRef, useEffect } from "react";

/** The path of the data file, wrapping when long, with a Copy path button and its result beside it. */
export function CopyablePath({ path }: { path: string | null }) {
  const [result, setResult] = useState("");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  async function copy() {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setResult("Path copied");
    } catch {
      setResult("Couldn't copy. Select the path and copy it yourself.");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setResult(""), 4000);
  }
  return (
    <div className="path-row">
      <p className="path-box" style={{ userSelect: "text" }}>
        {path ?? "Loading…"}
      </p>
      <div className="path-copy">
        <button type="button" className="modal-secondary" disabled={!path} onClick={() => void copy()}>
          Copy path
        </button>
        <span role="status" className="settings-feedback">{result}</span>
      </div>
    </div>
  );
}
