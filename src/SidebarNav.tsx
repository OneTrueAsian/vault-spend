import { NavIcon } from "./icons";
import { NAV_GROUP_LABELS, NAV_GROUP_ORDER, NAV_ITEMS, PINNED_NAV_ITEMS, type Tab } from "./appTypes";

interface SidebarNavProps {
  /** The reorderable tabs, in the person's saved order. */
  items: typeof NAV_ITEMS;
  activeTab: Tab;
  dragNavTab: Tab | null;
  onSelect: (tab: Tab) => void;
  onDragStartItem: (tab: Tab) => void;
  onDragEndItem: () => void;
  onDropItem: (tab: Tab) => void;
  /** Alt+Up/Down: the keyboard equivalent of dragging a tab within its group. */
  onMoveItem: (tab: Tab, direction: -1 | 1) => void;
}

/** The sidebar's tabs: the grouped, reorderable ones, then Settings and Help pinned below. Every tab
 * carries its name as `aria-label` (and its id as `data-tab`), because in a narrow window the visible
 * name is hidden and only the icon shows; the name then appears on hover and focus. */
export function SidebarNav({ items, activeTab, dragNavTab, onSelect, onDragStartItem, onDragEndItem, onDropItem, onMoveItem }: SidebarNavProps) {
  return (
    <>
      {NAV_GROUP_ORDER.map((group) => (
        <div className="nav-group" key={group}>
          <div className="nav-group-label" aria-hidden="true">{NAV_GROUP_LABELS[group]}</div>
          <nav className="nav-list" aria-label={NAV_GROUP_LABELS[group]}>
            {items
              .filter((item) => item.group === group)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  draggable
                  data-tab={item.id}
                  aria-label={item.label}
                  className={
                    activeTab === item.id
                      ? "nav-item nav-item-active"
                      : dragNavTab === item.id
                        ? "nav-item nav-item-dragging"
                        : "nav-item"
                  }
                  onClick={() => onSelect(item.id)}
                  onKeyDown={(e) => {
                    if (e.altKey && e.key === "ArrowUp") {
                      e.preventDefault();
                      onMoveItem(item.id, -1);
                    } else if (e.altKey && e.key === "ArrowDown") {
                      e.preventDefault();
                      onMoveItem(item.id, 1);
                    }
                  }}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  title="Drag to reorder, or focus and press Alt+↑/↓"
                  onDragStart={(e) => {
                    // Native drag-and-drop requires a payload via setData or
                    // the browser treats the drag as invalid and shows
                    // "not-allowed" over every drop target, regardless of
                    // what dragover/drop do.
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", item.id);
                    onDragStartItem(item.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    onDropItem(item.id);
                  }}
                  onDragEnd={onDragEndItem}
                >
                  <NavIcon name={item.icon} />
                  <span className="nav-text">{item.label}</span>
                </button>
              ))}
          </nav>
        </div>
      ))}
      <div className="sidebar-spacer"></div>
      <div className="sidebar-divider"></div>
      <nav className="nav-list" aria-label="Settings and help">
        {PINNED_NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-tab={item.id}
            aria-label={item.label}
            className={activeTab === item.id ? "nav-item nav-item-active" : "nav-item"}
            onClick={() => onSelect(item.id)}
          >
            <NavIcon name={item.icon} />
            <span className="nav-text">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
