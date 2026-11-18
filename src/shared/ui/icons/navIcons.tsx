type IconStyle = "default" | "futuristic";

function currentIconStyle(): IconStyle {
  if (typeof document === "undefined") return "default";
  return document.documentElement.getAttribute("data-palette") === "futuristic" ? "futuristic" : "default";
}

const PATHS: Record<string, string> = {
  home: "M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9",
  swap: "M4 7h13l-3-3M20 17H7l3 3",
  // Cash Flow's nav icon — a pulse/activity waveform, chosen to replace a
  // prior money-exchange glyph that user feedback flagged as not looking
  // representative of "cash flow."
  trend: "M22 12h-4l-3 9-6-18-3 9H2",
  pie: "M12 3v9l7.5 4.3M20.9 13.5A9 9 0 1 1 12 3",
  repeat: "M17 2 21 6l-4 4M3 12V9a3 3 0 0 1 3-3h15M7 22 3 18l4-4M21 12v3a3 3 0 0 1-3 3H3",
  barchart: "M4 20V10M12 20V4M20 20v-7",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9.6 9.4a2.4 2.4 0 1 1 3.4 2.2c-.7.3-1 .9-1 1.7v.2M12 16.8v.2",
};

// Futuristic — an angular/geometric reskin of the icon set used when the
// "Futuristic" theme is active (Settings > Appearance, data-palette on
// <html>): hex badges, chevrons and chamfered corners in place of circles
// and rounded corners, drawn with miter joins/butt caps for a sharper,
// more technical line quality than the default set above.
const FUTURISTIC_PATHS: Record<string, string> = {
  home: "M3.5 12 12 4.5l8.5 7.5M6.5 10.3V19h4.5v-5.5h2V19h4.5v-8.7",
  swap: "M4 7h13l-3-3M20 17H7l3 3",
  repeat: "M17 2 21 6l-4 4M3 13V9.2L5.8 6.5H21M7 22 3 18l4-4M21 11v3.8L18.2 17.5H3",
  pie: "M12 3 19.8 7.5 19.8 16.5 12 21 4.2 16.5 4.2 7.5ZM12 12V3M12 12 19.8 16.5",
};

const FUTURISTIC_SVG_PROPS = {
  strokeWidth: "1.6",
  strokeLinecap: "butt" as const,
  strokeLinejoin: "miter" as const,
};
const DEFAULT_SVG_PROPS = {
  strokeWidth: "1.8",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function NavIcon({ name }: { name: string }) {
  const futuristic = currentIconStyle() === "futuristic";
  const svgProps = futuristic ? FUTURISTIC_SVG_PROPS : DEFAULT_SVG_PROPS;

  if (name === "bank") {
    return futuristic ? (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M4 9 6.5 6.5 9 9l3-3 3 3 2.5-2.5L20 9" />
        <path d="M3 9.5h18" />
        <path d="M5.5 9.5V19M9.5 9.5V19M14.5 9.5V19M18.5 9.5V19" />
        <path d="M3 19.5h18" />
      </svg>
    ) : (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M3 9.5 12 4l9 5.5" />
        <path d="M3 9.5h18" />
        <path d="M5.5 9.5V19M9.5 9.5V19M14.5 9.5V19M18.5 9.5V19" />
        <path d="M3 19.5h18" />
      </svg>
    );
  }
  if (name === "wallet") {
    return futuristic ? (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M3 8 5 6h14l2 2v9l-2 2H5l-2-2z" />
        <path d="M3 11h18" />
        <path d="M15 14.5 16.7 16.2 15 17.9 13.3 16.2z" fill="currentColor" stroke="none" />
      </svg>
    ) : (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "profile") {
    return futuristic ? (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M12 4.2 15.4 8 12 11.8 8.6 8Z" />
        <path d="M4.5 20 6 14.3h12l1.5 5.7" />
      </svg>
    ) : (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      </svg>
    );
  }
  if (name === "users") {
    return futuristic ? (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M9 5 11.6 8 9 11 6.4 8Z" />
        <path d="M3.3 20 4.9 14.6h8.2L14.7 20" />
        <path d="M16.8 4.6 18.8 6.8 16.8 9 14.8 6.8Z" />
        <path d="M21 20 19.6 15.2h-2.6" />
      </svg>
    ) : (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M16 4.3a3 3 0 0 1 0 5.8" />
        <path d="M21 20c0-2.8-1.9-5.1-4.5-5.8" />
      </svg>
    );
  }
  if (name === "settings") {
    return futuristic ? (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M3 6h18M3 12h18M3 18h18" />
        <path d="M13.5 6l1.5-1.7 1.5 1.7-1.5 1.7z" fill="currentColor" stroke="none" />
        <path d="M7.5 12l1.5-1.7 1.5 1.7-1.5 1.7z" fill="currentColor" stroke="none" />
        <path d="M15.5 18l1.5-1.7 1.5 1.7-1.5 1.7z" fill="currentColor" stroke="none" />
      </svg>
    ) : (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M3 6h18M3 12h18M3 18h18" />
        <circle cx="15" cy="6" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="9" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <circle cx="17" cy="18" r="2.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "flag") {
    // Goals' nav icon — a bullseye, replacing the prior flag glyph after
    // the Buckets → Goals rename. Concentric circles read the same way in
    // both icon styles, so there's no separate futuristic variant here
    // (svgProps above already gives it the right stroke weight/joins).
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5.5" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "trend") {
    return futuristic ? (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M3 17 9 11l4 4 8-8M15 7h6v6" />
        <path d="M8.1 11.9 9.9 10.1 11.7 11.9 9.9 13.7z" fill="currentColor" stroke="none" />
      </svg>
    ) : (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d={PATHS.trend} />
      </svg>
    );
  }
  if (name === "barchart" && futuristic) {
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M4 20V11M12 20V5M20 20v-6" />
        <rect x="2.8" y="9" width="2.4" height="2.4" fill="currentColor" stroke="none" />
        <rect x="10.8" y="3" width="2.4" height="2.4" fill="currentColor" stroke="none" />
        <rect x="18.8" y="12.6" width="2.4" height="2.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "help" && futuristic) {
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
        <path d="M12 3 19.8 7.5 19.8 16.5 12 21 4.2 16.5 4.2 7.5Z" />
        <path d="M9.6 9.6 12 8l2.4 1.6v1.8l-2 1.2v1.1" />
        <rect x="11.3" y="15.2" width="1.6" height="1.6" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  const paths = futuristic ? FUTURISTIC_PATHS : PATHS;
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" {...svgProps} aria-hidden="true">
      <path d={paths[name] ?? PATHS[name] ?? ""} />
    </svg>
  );
}
