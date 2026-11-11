import { MenuSelect } from "../../shared/ui/MenuSelect";
import { LAYOUT_PRESETS, LAYOUT_PRESET_LABELS, type LayoutPresetKey, type WidgetId } from "../../shared/lib/dashboardLayout";
import type { useDashboardLayoutCustomization } from "./useDashboardLayoutCustomization";

/** The Layout menu's last entry: turns Customize on or off. Not a layout, so never saved as one. */
const CUSTOMIZE_OPTION = "__customize__";

export function DashboardLayoutToolbar({
  onSetLayoutWidgets,
  onOpenAddWidget,
  presetKey,
  layout,
}: {
  onSetLayoutWidgets: (next: WidgetId[]) => void;
  onOpenAddWidget: () => void;
  /** Which preset the current layout matches (see matchingLayoutPreset). */
  presetKey: string;
  layout: ReturnType<typeof useDashboardLayoutCustomization>;
}) {
  const { customizeMode, setCustomizeMode, customPresets, savingLayout, setSavingLayout, newLayoutName, setNewLayoutName, saveCurrentLayout, deleteCustomLayout } = layout;
  return (
    <div className="dashboard-toolbar">
      <MenuSelect
        ariaLabel="Layout"
        showName
        triggerClassName="layout-select-toggle"
        value={presetKey}
        options={[
          ...(Object.keys(LAYOUT_PRESETS) as LayoutPresetKey[]).map((key) => ({ value: key, label: LAYOUT_PRESET_LABELS[key] })),
          ...customPresets.map((p) => ({ value: `custom:${p.name}`, label: p.name })),
          ...(presetKey === "custom" ? [{ value: "custom", label: "Custom (unsaved)", disabled: true }] : []),
          { value: CUSTOMIZE_OPTION, label: customizeMode ? "Done customizing" : "Customize" },
        ]}
        onChange={(value) => {
          // Customize is an action, not a layout: it never changes the arrangement.
          if (value === CUSTOMIZE_OPTION) {
            setCustomizeMode((v) => !v);
          } else if (value.startsWith("custom:")) {
            const found = customPresets.find((p) => p.name === value.slice("custom:".length));
            if (found) onSetLayoutWidgets([...found.widgets]);
          } else {
            onSetLayoutWidgets([...LAYOUT_PRESETS[value as LayoutPresetKey]]);
          }
        }}
      />
      {presetKey === "custom" &&
        (savingLayout ? (
          <form
            className="saved-filter-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveCurrentLayout();
            }}
          >
            <input
              autoFocus
              value={newLayoutName}
              onChange={(e) => setNewLayoutName(e.target.value)}
              placeholder='e.g. "Weekly check-in"'
            />
            <button type="submit" className="btn-sm" disabled={!newLayoutName.trim()}>
              Save
            </button>
            <button
              type="button"
              className="modal-secondary btn-sm"
              onClick={() => {
                setSavingLayout(false);
                setNewLayoutName("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="modal-secondary btn-sm" onClick={() => setSavingLayout(true)}>
            + Save as
          </button>
        ))}
      {presetKey.startsWith("custom:") && (
        <button
          type="button"
          className="modal-secondary btn-sm"
          title="Delete this saved layout"
          onClick={() => deleteCustomLayout(presetKey.slice("custom:".length))}
        >
          Delete
        </button>
      )}
      {customizeMode && (
        <>
          <button type="button" className="modal-secondary btn-sm" onClick={onOpenAddWidget}>
            + Add widget
          </button>
          {/* Only while customizing: a visible way out (the Layout menu's "Done customizing" too). */}
          <button type="button" className="btn-sm" data-customize-done onClick={() => setCustomizeMode(false)}>
            Done
          </button>
        </>
      )}
    </div>
  );
}
