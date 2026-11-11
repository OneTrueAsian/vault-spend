import { type ThemeStyle } from "../../shared/lib/types";
import { type AppearancePrefs, DEFAULT_APPEARANCE_PREFS, type NeonAccent } from "../../shared/lib/themeBootstrap";
import { type Theme } from "../../shared/native/appTypes";
import transparentLightPreview from "../../assets/style-previews/transparent-light.webp";
import transparentDarkPreview from "../../assets/style-previews/transparent-dark.webp";
import futuristicLightPreview from "../../assets/style-previews/futuristic-light.webp";
import futuristicDarkPreview from "../../assets/style-previews/futuristic-dark.webp";
import retroLightPreview from "../../assets/style-previews/retro-light.webp";
import retroDarkPreview from "../../assets/style-previews/retro-dark.webp";
import { settingAttr, SettingStar } from "../../shared/ui/SettingStar";
import { ThemeSwitch } from "../../shared/ui/SidebarControls";

/** Each style shown as a picture (its Dashboard, captured by tools/capture-style-previews.mjs) in the
 * light or dark the app is showing, with a one-line description. */
const THEME_STYLE_OPTIONS: { id: ThemeStyle; label: string; description: string; previews: { light: string; dark: string } }[] = [
  {
    id: "transparent",
    label: "Default",
    description: "Clean and soft, with see-through panels.",
    previews: { light: transparentLightPreview, dark: transparentDarkPreview },
  },
  {
    id: "futuristic",
    label: "Futuristic",
    description: "Neon colors on dark blue. Pick the glow color below.",
    previews: { light: futuristicLightPreview, dark: futuristicDarkPreview },
  },
  {
    id: "retro",
    label: "Retro",
    description: "Classic gray desktop look with square corners.",
    previews: { light: retroLightPreview, dark: retroDarkPreview },
  },
];

const ACCENT_OPTIONS: { id: NeonAccent; label: string }[] = [
  { id: "cyan", label: "Ion Cyan" },
  { id: "pink", label: "Rebel Pink" },
  { id: "violet", label: "Ultraviolet" },
];

export function AppearanceSection({
  themeStyle,
  onSetThemeStyle,
  appearance,
  onSetAppearance,
  theme,
  onSetTheme,
  resolvedTheme,
}: {
  themeStyle: ThemeStyle;
  onSetThemeStyle: (style: ThemeStyle) => void;
  appearance: AppearancePrefs;
  onSetAppearance: (next: AppearancePrefs) => void;
  theme: Theme;
  onSetTheme: (t: Theme) => void;
  /** The light or dark actually showing, so the pictures match it. */
  resolvedTheme: "light" | "dark";
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="reports-section-title">Appearance</h2>
      </div>
      <p className="modal-message-secondary">
        Choose how Vault Spend looks. This only changes colors, fonts and shapes, not how the app works.
      </p>
      <div className="appearance-theme" {...settingAttr("theme")}>
        <span className="feature-toggle-label" id="appearance-light-dark">Light or dark</span>
        <ThemeSwitch theme={theme} onSetTheme={onSetTheme} className="view-toggle" labelledBy="appearance-light-dark" />
        <SettingStar id="theme" />
      </div>
      <div className="setting-style" {...settingAttr("style")}>
      <div className="setting-title">
        <span className="feature-toggle-label">Style</span>
        <SettingStar id="style" />
      </div>
      <div className="style-preview-grid" role="radiogroup" aria-label="Style">
        {THEME_STYLE_OPTIONS.map((opt) => (
          <label key={opt.id} className={themeStyle === opt.id ? "style-preview-tile style-preview-tile-checked" : "style-preview-tile"}>
            <input
              type="radio"
              name="theme-style"
              className="style-preview-radio"
              checked={themeStyle === opt.id}
              aria-label={opt.label}
              aria-describedby={`style-description-${opt.id}`}
              onChange={() => onSetThemeStyle(opt.id)}
            />
            <img
              className="style-preview-image"
              src={opt.previews[resolvedTheme]}
              alt={`${opt.label} style preview`}
              width={480}
              height={300}
            />
            <span className="style-preview-name">{opt.label}</span>
            <span className="style-preview-description" id={`style-description-${opt.id}`}>{opt.description}</span>
          </label>
        ))}
      </div>
      </div>
      {themeStyle === "futuristic" && (
        <div className="futuristic-options" data-futuristic-options>
          <span className="feature-toggle-label">Futuristic options</span>
          <div className="accent-choices" role="radiogroup" aria-label="Accent color">
            {ACCENT_OPTIONS.map((opt) => {
              const checked = appearance.accent === opt.id;
              return (
                <label key={opt.id} className={`accent-choice${checked ? " accent-choice-checked" : ""}`}>
                  <input
                    type="radio"
                    name="neon-accent"
                    checked={checked}
                    onChange={() => onSetAppearance({ ...appearance, accent: opt.id })}
                  />
                  <span className={`accent-swatch accent-swatch-${opt.id}`} aria-hidden="true" />
                  {opt.label}
                  {checked && (
                    <span className="accent-check" data-accent-check aria-hidden="true" />
                  )}
                </label>
              );
            })}
          </div>
          <label className="neon-intensity">
            <span className="neon-intensity-head">
              <span>Neon intensity</span>
              <span className="neon-intensity-value">{appearance.intensity}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              aria-label="Neon intensity"
              value={appearance.intensity}
              onChange={(e) => onSetAppearance({ ...appearance, intensity: Number(e.currentTarget.value) })}
            />
            <span className="modal-message-secondary">
              How strongly the colored glow shows. At 0 the glow is off; text, outlines, and colors that carry
              meaning stay the same.
            </span>
          </label>
          <div>
            <button type="button" className="modal-secondary" onClick={() => onSetAppearance(DEFAULT_APPEARANCE_PREFS)}>
              Reset Futuristic options
            </button>
          </div>
        </div>
      )}
      <div className="setting-row" {...settingAttr("reduce-motion")}>
<label className="feature-toggle-row reduce-motion-row">
        <input
          type="checkbox"
          data-reduce-motion
          checked={appearance.reduceMotion}
          onChange={(e) => onSetAppearance({ ...appearance, reduceMotion: e.currentTarget.checked })}
        />
        <span className="feature-toggle-text">
          <span className="feature-toggle-label">Reduce motion</span>
          <span className="modal-message-secondary">
            Turns off sliding and fading effects in every style. If your computer is set to reduce motion, that is
            always followed too.
          </span>
        </span>
      </label>
<SettingStar id="reduce-motion" />
</div>
    </div>
  );
}
