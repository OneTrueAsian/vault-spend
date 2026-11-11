import { type StatusKind } from "../../shared/native/appTypes";
import { type LivePriceProviderId, type LivePriceRefreshSummary } from "../../shared/lib/types";
import { errorMessage } from "../../shared/lib/errorMessage";
import { summarizeLivePriceRefresh } from "./livePriceStatus";

export function useInvestmentActions({ invoke, refreshLivePriceSettings, setStatus, refreshHoldings, refreshAssets }: {
  invoke: <T>(command: string, args?: Record<string, unknown> | undefined) => Promise<T>;
  refreshLivePriceSettings: () => Promise<void>;
  setStatus: (text: string, kind?: StatusKind) => void;
  refreshHoldings: () => Promise<void>;
  refreshAssets: () => Promise<void>;
}) {
  async function handleSetLivePriceApiKey(provider: LivePriceProviderId, apiKey: string | null) {
    try {
      await invoke("set_live_price_settings", { provider, apiKey });
      await refreshLivePriceSettings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleRefreshLivePrices() {
    try {
      const summary = await invoke<LivePriceRefreshSummary>("refresh_live_prices");
      await Promise.all([refreshHoldings(), refreshLivePriceSettings()]);
      const { text, kind } = summarizeLivePriceRefresh(summary);
      setStatus(text, kind);
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleFetchLiveQuote(symbol: string): Promise<string | null> {
    try {
      return await invoke<string | null>("fetch_live_quote", { symbol });
    } catch {
      return null; // convenience autofill only — swallow errors rather than interrupting the form
    }
  }

  async function handleCreateHolding(
    accountId: number,
    symbol: string,
    name: string,
    shares: string,
    price: string,
    costBasis: string,
    assetClass: string | null,
  ) {
    try {
      await invoke("create_holding", { accountId, symbol, name, shares, price, costBasis, assetClass });
      await refreshHoldings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateHoldingPrice(id: number, price: string) {
    try {
      await invoke("update_holding_price", { id, price });
      await refreshHoldings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAllocationTargets(targets: { assetClass: string; percent: string }[]) {
    try {
      for (const t of targets) {
        await invoke("set_allocation_target", { assetClass: t.assetClass, percent: t.percent });
      }
      await refreshHoldings();
      setStatus("Target allocation saved.", "success");
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteHolding(id: number) {
    try {
      await invoke("delete_holding", { id });
      await refreshHoldings();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleCreateAsset(
    name: string,
    assetType: string,
    value: string,
    valuedOn: string,
    notes: string | null,
    memberId: number | null,
  ) {
    try {
      const id = await invoke<number>("create_asset", { name, assetType, value, valuedOn, notes });
      if (memberId !== null) {
        await invoke("set_asset_member", { id, memberId });
      }
      await refreshAssets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleUpdateAssetValue(id: number, value: string, valuedOn: string) {
    try {
      await invoke("update_asset_value", { id, value, valuedOn });
      await refreshAssets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleSetAssetMember(id: number, memberId: number | null) {
    try {
      await invoke("set_asset_member", { id, memberId });
      await refreshAssets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  async function handleDeleteAsset(id: number) {
    try {
      await invoke("delete_asset", { id });
      await refreshAssets();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  return { handleSetLivePriceApiKey, handleRefreshLivePrices, handleFetchLiveQuote, handleCreateHolding, handleUpdateHoldingPrice, handleSetAllocationTargets, handleDeleteHolding, handleCreateAsset, handleUpdateAssetValue, handleSetAssetMember, handleDeleteAsset };
}
