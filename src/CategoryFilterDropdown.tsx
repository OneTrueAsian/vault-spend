import { MenuSelect } from "./MenuSelect";

/** The Transactions toolbar's category filter: a `MenuSelect` named for what it filters.
 * App.tsx supplies the option list, including the "All categories" and "Uncategorized" sentinels. */
export function CategoryFilterDropdown({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <MenuSelect
      options={options}
      value={value}
      onChange={onChange}
      ariaLabel="Filter by category"
      triggerClassName="category-filter-toggle"
      panelClassName="category-filter-panel"
    />
  );
}
