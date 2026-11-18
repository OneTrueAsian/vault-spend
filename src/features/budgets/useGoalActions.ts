import { type StatusKind } from "../../shared/native/appTypes";
import { errorMessage } from "../../shared/lib/errorMessage";

export function useGoalActions({ invoke, refreshBuckets, checkSinkingFundContributions, setStatus }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  refreshBuckets: () => Promise<void>;
  checkSinkingFundContributions: () => Promise<void>;
  setStatus: (text: string, kind?: StatusKind) => void;
}) {
  async function handleCreateBucket(
    name: string,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    memberId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
    tracksAccount: boolean,
  ) {
    try {
      const id = await invoke<number>("create_bucket", {
        name,
        targetAmount,
        targetDate,
        accountId,
        sinkingAmount,
        color,
        iconKey,
      });
      if (memberId !== null) {
        await invoke("set_bucket_member", { id, memberId });
      }
      if (tracksAccount && accountId !== null) {
        await invoke("set_bucket_tracks_account", { id, tracksAccount });
      }
      await refreshBuckets();
      // A brand-new auto-contribute bucket didn't exist yet the last time
      // this month's contributions were checked (at launch) — check again
      // now so it doesn't sit at $0 until the app is next reopened.
      if (sinkingAmount !== null) {
        await checkSinkingFundContributions();
        await refreshBuckets();
      }
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateBucketDetails(
    id: number,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    sinkingAmount: string | null,
    color: string | null,
    iconKey: string | null,
    tracksAccount: boolean,
    newName: string | null,
  ): Promise<boolean> {
    try {
      // The rename goes first: a name that is blank or already in use is refused, and then nothing else is saved.
      if (newName !== null) await invoke("rename_bucket", { id, newName });
      await invoke("update_bucket_details", { id, targetAmount, targetDate, accountId, sinkingAmount, color, iconKey });
      await invoke("set_bucket_tracks_account", { id, tracksAccount: tracksAccount && accountId !== null });
      await refreshBuckets();
      // Same reasoning as handleCreateBucket: a sinking amount just added
      // (or changed) here was invisible to the launch-time check, so catch
      // it up immediately rather than making the user reload.
      if (sinkingAmount !== null) {
        await checkSinkingFundContributions();
        await refreshBuckets();
      }
      return true;
    } catch (e) {
      setStatus(errorMessage(e));
      return false;
    }
  }

  async function handleAddContribution(bucketId: number, date: string, amount: string, note: string | null) {
    try {
      await invoke("add_bucket_contribution", { bucketId, date, amount, note });
      await refreshBuckets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteBucket(id: number) {
    try {
      await invoke("delete_bucket", { id });
      await refreshBuckets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSaveProjectionAsGoal(name: string, targetAmount: string, targetDate: string) {
    await handleCreateBucket(name, targetAmount, targetDate, null, null, null, null, null, false);
    setStatus(`Saved "${name}" as a goal — it's on the Goals page.`, "success");
  }

  return { handleCreateBucket, handleUpdateBucketDetails, handleAddContribution, handleDeleteBucket, handleSaveProjectionAsGoal };
}
