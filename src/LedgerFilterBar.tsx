import "./Ledger.css";
import type * as React from "react";

import { CategoryFilterDropdown } from "./CategoryFilterDropdown";

import { AccountFilterDropdown, type AccountFilterValue } from "./AccountFilterDropdown";
import { MemberFilterDropdown, type MemberFilterValue } from "./MemberFilterDropdown";
import { MoreFiltersPopover } from "./MoreFiltersPopover";

import type { Account, FamilyMember } from "./types";

interface LedgerFilterBarProps {
  searchText: string;
  setSearchText: React.Dispatch<React.SetStateAction<string>>;
  categoryFilterOptions: { value: string; label: string; }[];
  filterCategory: string;
  setFilterCategory: React.Dispatch<React.SetStateAction<string>>;
  accounts: Account[];
  filterAccountIds: AccountFilterValue;
  setFilterAccountIds: React.Dispatch<React.SetStateAction<AccountFilterValue>>;
  familyMembers: FamilyMember[];
  filterMemberIds: MemberFilterValue;
  setFilterMemberIds: React.Dispatch<React.SetStateAction<MemberFilterValue>>;
  filterFrom: string;
  setFilterFrom: React.Dispatch<React.SetStateAction<string>>;
  filterTo: string;
  setFilterTo: React.Dispatch<React.SetStateAction<string>>;
  filterTag: string;
  allTags: string[];
  setFilterTag: React.Dispatch<React.SetStateAction<string>>;
}

export function LedgerFilterBar({
  searchText,
  setSearchText,
  categoryFilterOptions,
  filterCategory,
  setFilterCategory,
  accounts,
  filterAccountIds,
  setFilterAccountIds,
  familyMembers,
  filterMemberIds,
  setFilterMemberIds,
  filterFrom,
  setFilterFrom,
  filterTo,
  setFilterTo,
  filterTag,
  allTags,
  setFilterTag,
}: LedgerFilterBarProps) {
  return (
    <div className="ledger-filters">
      <input
        type="search"
        placeholder="Search description…"
        aria-label="Search description"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
      />
      <CategoryFilterDropdown options={categoryFilterOptions} value={filterCategory} onChange={setFilterCategory} />
      <AccountFilterDropdown accounts={accounts} value={filterAccountIds} onChange={setFilterAccountIds} />
      <MemberFilterDropdown members={familyMembers} value={filterMemberIds} onChange={setFilterMemberIds} />
      <MoreFiltersPopover
        filterFrom={filterFrom}
        onSetFrom={setFilterFrom}
        filterTo={filterTo}
        onSetTo={setFilterTo}
        filterTag={filterTag}
        allTags={allTags}
        onSetTag={setFilterTag}
      />
      <datalist id="known-tags">
        {allTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
