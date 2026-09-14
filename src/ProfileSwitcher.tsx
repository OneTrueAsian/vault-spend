import { useEffect, useRef, useState } from "react";
import type { Profile } from "./types";
import { ProfileIcon } from "./icons";

/** Always-visible sidebar widget showing which profile is currently active
 * and letting the user jump straight to another one — same click-outside-
 * to-close pattern as AccountFilterDropdown. Full profile management
 * (create/rename/delete) still lives on the Settings tab; this is just fast
 * visibility + switching from anywhere in the app. */
export function ProfileSwitcher({
  profiles,
  onSwitchProfile,
  onManageProfiles,
}: {
  profiles: Profile[];
  onSwitchProfile: (id: string) => void;
  onManageProfiles: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const current = profiles.find((p) => p.is_active);

  return (
    <div className="profile-switcher" ref={rootRef}>
      <button
        type="button"
        className="profile-switcher-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <ProfileIcon iconKey={current?.icon_key} className="profile-switcher-icon" />
        <span className="profile-switcher-name">{current?.name ?? "Profile"}</span>
        <span className="account-filter-caret">▾</span>
      </button>
      {open && (
        <div className="profile-switcher-panel">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className={
                p.is_active ? "profile-switcher-option profile-switcher-option-active" : "profile-switcher-option"
              }
              onClick={() => {
                if (!p.is_active) onSwitchProfile(p.id);
                setOpen(false);
              }}
            >
              <ProfileIcon iconKey={p.icon_key} className="profile-switcher-icon" />
              {p.name}
              {p.is_active && " (current)"}
            </button>
          ))}
          <button
            type="button"
            className="profile-switcher-manage"
            onClick={() => {
              setOpen(false);
              onManageProfiles();
            }}
          >
            Manage profiles…
          </button>
        </div>
      )}
    </div>
  );
}
