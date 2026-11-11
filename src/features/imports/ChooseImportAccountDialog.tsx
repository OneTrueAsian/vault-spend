import { type Account } from "../../shared/lib/types";
import { useState } from "react";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { pickableAccounts } from "../../shared/lib/hiddenAccounts";
import { ModalShell } from "../../shared/ui/Modal";

const NEW_ACCOUNT_CHOICE = "__new__";

/** The first step of "Import transactions": the account is always chosen here, never carried over from
 * whatever the page happens to be showing, so a file can't land in the wrong account by default. */
export function ChooseImportAccountDialog({
  accounts,
  onCancel,
  onChoose,
  onNewAccount,
}: {
  accounts: Account[];
  onCancel: () => void;
  onChoose: (accountId: number) => void;
  onNewAccount: () => void;
}) {
  const [chosen, setChosen] = useState("");
  return (
    <ModalShell title="Which account are these transactions from?" onCancel={onCancel}>
      <p className="modal-message">
        Pick the account this file belongs to. Everything in it will be added to that account.
      </p>
      <MenuSelect
        ariaLabel="Account to import into"
        value={chosen}
        placeholder="Choose an account…"
        options={[
          ...pickableAccounts(accounts, chosen).map((a) => ({ value: String(a.id), label: a.name })),
          { value: NEW_ACCOUNT_CHOICE, label: "+ New account" },
        ]}
        onChange={(next) => (next === NEW_ACCOUNT_CHOICE ? onNewAccount() : setChosen(next))}
        triggerAttrs={{ "data-import-account": true }}
        fill
      />
      <div className="modal-actions">
        <button type="button" className="modal-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={chosen === ""} onClick={() => chosen !== "" && onChoose(Number(chosen))}>
          Continue
        </button>
      </div>
    </ModalShell>
  );
}
