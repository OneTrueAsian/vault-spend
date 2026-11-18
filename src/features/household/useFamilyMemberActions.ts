import type { TransactionSnapshot } from "../../shared/native/transactionContracts";
import { type StatusKind } from "../../shared/native/appTypes";
import { errorMessage } from "../../shared/lib/errorMessage";

export function useFamilyMemberActions({ invoke, refresh, setStatus }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  refresh: () => Promise<TransactionSnapshot>;
  setStatus: (text: string, kind?: StatusKind) => void;
}) {
  async function handleCreateFamilyMember(name: string) {
    try {
      await invoke("create_family_member", { name });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRenameFamilyMember(id: number, newName: string) {
    try {
      await invoke("rename_family_member", { id, newName });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteFamilyMember(id: number) {
    try {
      await invoke("delete_family_member", { id });
      await refresh();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  return { handleCreateFamilyMember, handleRenameFamilyMember, handleDeleteFamilyMember };
}
