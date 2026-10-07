import { type Theme } from "./appTypes";

const THEMES: Theme[] = ["light", "dark", "system"];
const themeName = (t: Theme) => t[0].toUpperCase() + t.slice(1);
const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];

interface SidebarControlsProps {
  privacyHidden: boolean;
  onTogglePrivacy: () => void;
  theme: Theme;
  onSetTheme: (t: Theme) => void;
}

/** Light / Dark / System, at the foot of the sidebar and in Settings > Appearance. `className` adds the
 * place's own look to the shared `theme-toggle` group. The group is named "Theme", or by a visible label
 * when `labelledBy` gives its id (Settings, so the page doesn't have two groups called "Theme"). */
export function ThemeSwitch({
  theme,
  onSetTheme,
  className,
  labelledBy,
}: {
  theme: Theme;
  onSetTheme: (t: Theme) => void;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <div
      className={className ? `theme-toggle ${className}` : "theme-toggle"}
      role="group"
      {...(labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": "Theme" })}
    >
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          className={theme === t ? "theme-toggle-active" : ""}
          aria-pressed={theme === t}
          onClick={() => onSetTheme(t)}
        >
          {themeName(t)}
        </button>
      ))}
    </div>
  );
}

/** Hide amounts and Light / Dark / System, at the foot of the sidebar (they used to fill a top bar). */
export function SidebarControls({ privacyHidden, onTogglePrivacy, theme, onSetTheme }: SidebarControlsProps) {
  const next = nextTheme(theme);
  return (
    <div className="sidebar-controls">
      <button
        type="button"
        className={privacyHidden ? "privacy-toggle privacy-toggle-on" : "privacy-toggle"}
        data-privacy-toggle
        aria-pressed={privacyHidden}
        title={privacyHidden ? "Amounts are hidden — click to show them" : "Hide every dollar amount on screen"}
        onClick={onTogglePrivacy}
      >
        {privacyHidden ? "Show amounts" : "Hide amounts"}
      </button>
      <ThemeSwitch theme={theme} onSetTheme={onSetTheme} />
      <button
        type="button"
        className="theme-cycle"
        data-theme-cycle
        aria-label={`Theme: ${themeName(theme)}. Switch to ${themeName(next)}.`}
        title={`Theme: ${themeName(theme)}. Switch to ${themeName(next)}.`}
        onClick={() => onSetTheme(next)}
      >
        <span aria-hidden="true">↻</span>
        <span className="sr-only">{themeName(theme)}</span>
      </button>
    </div>
  );
}
