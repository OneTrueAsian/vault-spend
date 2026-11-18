import { PasswordForm } from "../../shared/ui/PasswordForm";
import { ModalShell } from "../../shared/ui/Modal";

/** Switching to a password-protected profile from inside the running app (Phase C, Task 7, decision
 * 4) — asks for its password instead of calling the plain `switch_profile` command, which has no
 * way to unlock anything. Wraps the same `PasswordForm` `ProfileLockScreen` uses, so a wrong
 * password behaves identically in both places. Nothing about the currently open profile is touched
 * unless `onSubmit` itself succeeds — a rejected `onSubmit` leaves this dialog open with the error
 * inline, same as any other failed attempt. */
export function SwitchToProtectedProfileDialog({
  profileName,
  onCancel,
  onSubmit,
}: {
  profileName: string;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  return (
    <ModalShell title={`${profileName} is password protected`} onCancel={onCancel}>
      <PasswordForm submitLabel="Switch" onSubmit={onSubmit} onCancel={onCancel} />
    </ModalShell>
  );
}
