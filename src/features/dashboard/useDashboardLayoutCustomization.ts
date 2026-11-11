import { useEffect, useState } from "react";
import { loadCustomLayoutPresets, saveCustomLayoutPresets, type SavedLayoutPreset, type WidgetId } from "../../shared/lib/dashboardLayout";
import { ensureUiStateMigrated } from "../../shared/lib/profileUiState";

/** Customize mode, drag state and the saved-layout presets for the Dashboard. State lives for as long as DashboardView is mounted. */
export function useDashboardLayoutCustomization(layoutWidgets: WidgetId[]) {
  const [customizeMode, setCustomizeMode] = useState(false);
  const [dragWidgetId, setDragWidgetId] = useState<WidgetId | null>(null);
  const [customPresets, setCustomPresets] = useState<SavedLayoutPreset[]>([]);
  const [savingLayout, setSavingLayout] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState("");

  // DashboardView remounts fresh whenever App does (a profile switch/lock changes App's own React
  // `key`), so this load can never hand one profile's presets to another. React fires child effects
  // before parent effects, so this can run before App's own migration effect — `ensureUiStateMigrated`
  // is safe to call from more than one place at once (see profileUiState.ts), and calling it here too
  // is what makes a first-launch-after-upgrade legacy preset show up on this very render instead of
  // only after the next reload.
  useEffect(() => {
    let cancelled = false;
    ensureUiStateMigrated()
      .catch(() => {}) // best effort — the same treatment every browser-storage read/write here already gets
      .then(() => loadCustomLayoutPresets())
      .then((presets) => {
        if (!cancelled) setCustomPresets(presets);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function saveCurrentLayout() {
    const name = newLayoutName.trim();
    if (!name) return;
    const snapshot: SavedLayoutPreset = { name, widgets: layoutWidgets };
    // Saving under a name that's already in use replaces it, rather than
    // accumulating duplicates — same rule as the Transactions tab's saved filters.
    const next = [...customPresets.filter((p) => p.name !== name), snapshot];
    setCustomPresets(next);
    saveCustomLayoutPresets(next);
    setNewLayoutName("");
    setSavingLayout(false);
  }

  function deleteCustomLayout(name: string) {
    const next = customPresets.filter((p) => p.name !== name);
    setCustomPresets(next);
    saveCustomLayoutPresets(next);
  }

  return { customizeMode, setCustomizeMode, dragWidgetId, setDragWidgetId, customPresets, savingLayout, setSavingLayout, newLayoutName, setNewLayoutName, saveCurrentLayout, deleteCustomLayout };
}
