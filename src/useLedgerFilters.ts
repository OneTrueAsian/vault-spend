import { useEffect, useState } from "react";
import type { AccountFilterValue } from "./AccountFilterDropdown";
import type { MemberFilterValue } from "./MemberFilterDropdown";
import type { SavedLedgerFilter } from "./appTypes";
import { loadSavedFilters, saveSavedFilters } from "./appStorage";
import { ensureUiStateMigrated } from "./profileUiState";

export function useLedgerFilters() {
  const [searchText, setSearchText] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterAccountIds, setFilterAccountIds] = useState<AccountFilterValue>("all");
  const [filterMemberIds, setFilterMemberIds] = useState<MemberFilterValue>("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterTag, setFilterTag] = useState("all");
  const [savedFilters, setSavedFilters] = useState<SavedLedgerFilter[]>([]);
  const [savingFilter, setSavingFilter] = useState(false);
  const [newFilterName, setNewFilterName] = useState("");

  useEffect(() => {
    let cancelled = false;
    ensureUiStateMigrated()
      .catch(() => { }) // best effort — the same treatment every browser-storage read/write here already gets
      .then(() => loadSavedFilters())
      .then((filters) => {
        if (!cancelled) setSavedFilters(filters);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function saveCurrentFilter() {
    const name = newFilterName.trim();
    if (!name) return;
    const snapshot: SavedLedgerFilter = {
      name,
      searchText,
      filterCategory,
      filterAccountIds: filterAccountIds === "all" ? "all" : Array.from(filterAccountIds),
      filterMemberIds: filterMemberIds === "all" ? "all" : Array.from(filterMemberIds),
      filterFrom,
      filterTo,
      filterTag,
    };
    // Saving under a name that's already in use replaces it, rather than
    // accumulating duplicates.
    const next = [...savedFilters.filter((f) => f.name !== name), snapshot];
    setSavedFilters(next);
    saveSavedFilters(next);
    setNewFilterName("");
    setSavingFilter(false);
  }

  function applySavedFilter(filter: SavedLedgerFilter) {
    setSearchText(filter.searchText);
    setFilterCategory(filter.filterCategory);
    setFilterAccountIds(filter.filterAccountIds === "all" ? "all" : new Set(filter.filterAccountIds));
    setFilterMemberIds(filter.filterMemberIds === "all" ? "all" : new Set(filter.filterMemberIds));
    setFilterFrom(filter.filterFrom);
    setFilterTo(filter.filterTo);
    setFilterTag(filter.filterTag);
  }

  function deleteSavedFilter(name: string) {
    const next = savedFilters.filter((f) => f.name !== name);
    setSavedFilters(next);
    saveSavedFilters(next);
  }

  return {
    searchText,
    setSearchText,
    filterCategory,
    setFilterCategory,
    filterAccountIds,
    setFilterAccountIds,
    filterMemberIds,
    setFilterMemberIds,
    filterFrom,
    setFilterFrom,
    filterTo,
    setFilterTo,
    filterTag,
    setFilterTag,
    savedFilters,
    savingFilter,
    setSavingFilter,
    newFilterName,
    setNewFilterName,
    saveCurrentFilter,
    applySavedFilter,
    deleteSavedFilter,
  };
}
