import { type LivePriceProviderId, type LivePriceSettings } from "../../shared/lib/types";
import { useState, useEffect, FormEvent } from "react";
import { cardAttr, SettingStar } from "../../shared/ui/SettingStar";
import { MoreInfo } from "../../shared/ui/MoreInfo";
import { MenuSelect } from "../../shared/ui/MenuSelect";
import { openUrl } from "@tauri-apps/plugin-opener";

const LIVE_PRICE_PROVIDERS: Record<
  LivePriceProviderId,
  { label: string; signupUrl: string; keyPlaceholder: string; blurb: string; usageNote: string; refreshNote: string }
> = {
  alpha_vantage: {
    label: "Alpha Vantage",
    signupUrl: "https://www.alphavantage.co/support/#api-key",
    keyPlaceholder: "Alpha Vantage API key",
    blurb:
      "Alpha Vantage's free tier is limited to 25 requests/day — plenty for a small portfolio checked a few times a day, tight for a large one refreshed constantly.",
    usageNote: "using your Alpha Vantage API key",
    refreshNote: "one request per distinct symbol you hold",
  },
  finnhub: {
    label: "Finnhub",
    signupUrl: "https://finnhub.io/register",
    keyPlaceholder: "Finnhub API key",
    blurb:
      "Finnhub's free tier allows 60 requests/minute — comfortably more than this app needs at once, so there's no daily cap to track.",
    usageNote: "using your Finnhub API key",
    refreshNote: "one request per distinct symbol you hold",
  },
  twelve_data: {
    label: "Twelve Data",
    signupUrl: "https://twelvedata.com/register",
    keyPlaceholder: "Twelve Data API key",
    blurb: "Twelve Data's free tier is limited to 800 requests/day — plenty for a large portfolio checked often.",
    usageNote: "using your Twelve Data API key",
    refreshNote: "one request per distinct symbol you hold",
  },
  stockdata_org: {
    label: "StockData.org",
    signupUrl: "https://www.stockdata.org/register",
    keyPlaceholder: "StockData.org API key",
    blurb:
      "StockData.org's free tier is limited to 100 requests/day, but each request can price up to 3 symbols at once — a portfolio of 9 symbols costs 3 requests, not 9.",
    usageNote: "using your StockData.org API key",
    refreshNote: "up to 3 symbols priced per request",
  },
};

export function LivePricesSection({
  settings,
  onSetApiKey,
  onRefreshNow,
}: {
  settings: LivePriceSettings | null;
  onSetApiKey: (provider: LivePriceProviderId, apiKey: string | null) => void;
  onRefreshNow: () => void;
}) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [pickerProvider, setPickerProvider] = useState<LivePriceProviderId>(settings?.provider ?? "alpha_vantage");

  // Keep the picker in sync with the last-saved provider whenever the
  // feature is off, so re-opening Settings pre-selects what was last used
  // rather than always resetting to Alpha Vantage.
  const savedEnabled = settings?.enabled;
  const savedProvider = settings?.provider;
  useEffect(() => {
    if (savedEnabled === false && savedProvider) setPickerProvider(savedProvider);
  }, [savedEnabled, savedProvider]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    onSetApiKey(pickerProvider, trimmed);
    setApiKeyInput("");
  }

  const used = settings?.requests_used_today ?? 0;
  const limit = settings?.requests_limit ?? null;
  const atLimit = limit != null && used >= limit;
  // "Approaching" starts 5 requests before the cutoff — early enough to be
  // a heads-up, not just a surprise the moment it's already too late.
  const approachingLimit = limit != null && !atLimit && used >= limit - 5;

  return (
    <div className="card" {...cardAttr("live-prices")}>
      <div className="card-head">
        <h2 className="reports-section-title">Live stock prices</h2>
        <SettingStar id="live-prices" />
      </div>
      {settings?.enabled ? (
        <>
          <p className="modal-message-secondary">
            Prices refresh when the app opens and every 2 hours while it stays open —{" "}
            {LIVE_PRICE_PROVIDERS[settings.provider].refreshNote}, {LIVE_PRICE_PROVIDERS[settings.provider].usageNote}.{" "}
            <MoreInfo>New holdings can also fill in their starting price by symbol.</MoreInfo>
          </p>
          <p className="modal-message-secondary">
            Last refreshed: {settings.last_refreshed_at ?? "not yet — click Refresh now below"}
          </p>
          {limit != null ? (
            <p
              className={
                atLimit ? "live-price-usage live-price-usage-limit"
                : approachingLimit ? "live-price-usage live-price-usage-warning"
                : "live-price-usage"
              }
            >
              {atLimit
                ? `Daily limit reached (${used}/${limit}) — refreshes and autofill are paused until tomorrow.`
                : approachingLimit
                  ? `${used} of ${limit} requests used today — getting close to the daily limit.`
                  : `${used} of ${limit} requests used today.`}
            </p>
          ) : (
            <p className="modal-message-secondary">
              {used} request{used === 1 ? "" : "s"} used today — Finnhub's free tier allows 60 requests/minute, so
              there's no daily cap to track.
            </p>
          )}
          <div className="category-manage-actions">
            <button type="button" className="modal-secondary" onClick={onRefreshNow} disabled={atLimit}>
              Refresh now
            </button>
            <button type="button" className="modal-secondary" onClick={() => onSetApiKey(settings.provider, null)}>
              Disable
            </button>
          </div>
        </>
      ) : (
        <>
          <MenuSelect
            ariaLabel="Live price provider"
            value={pickerProvider}
            onChange={(v) => setPickerProvider(v as LivePriceProviderId)}
            options={(Object.keys(LIVE_PRICE_PROVIDERS) as LivePriceProviderId[]).map((id) => ({ value: id, label: LIVE_PRICE_PROVIDERS[id].label }))}
            fill
          />
          <p className="modal-message-secondary">
            Off by default — you edit holding prices yourself on the Investments tab. Add a free{" "}
            {LIVE_PRICE_PROVIDERS[pickerProvider].label} API key to fill in and update prices for you.
          </p>
          <p className="modal-message-secondary">{LIVE_PRICE_PROVIDERS[pickerProvider].blurb}</p>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => openUrl(LIVE_PRICE_PROVIDERS[pickerProvider].signupUrl)}
          >
            Get a free API key →
          </button>
          <form className="category-create-form" onSubmit={handleSave}>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={LIVE_PRICE_PROVIDERS[pickerProvider].keyPlaceholder}
            />
            <button type="submit" disabled={!apiKeyInput.trim()}>
              Save
            </button>
          </form>
        </>
      )}
    </div>
  );
}
