import { MAX_MOBILE_SNAPSHOT_BYTES } from "./mobileSnapshot";
import type { MobileRepository, SnapshotBinding } from "./mobileRepository";
export interface MobileStatus { installationId: string; csrf: string; profiles: { id: string; epoch: string; name: string; icon: string | null; refreshable?:boolean }[] }
type Fetcher = typeof fetch;
const pending = new Set<string>();
export class MobileConnectionError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MobileConnectionError"; }
}
async function request(route: string, maximum: number, fetcher: Fetcher, body?: object, csrf?: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16000);
  try {
    const response = await fetcher(route, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: { "X-Vault-Request": "1", ...(body ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "X-Vault-CSRF": csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const reader = response.body?.getReader();
    if (!reader) throw new MobileConnectionError("mobile_response_invalid");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > (response.ok ? maximum : Math.min(maximum, 4096))) { await reader.cancel(); throw new MobileConnectionError("mobile_response_too_large"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!response.ok) {
      let code = response.status === 401 || response.status === 403 ? "mobile_access_denied" : response.status === 429 ? "mobile_refresh_limited" : "mobile_refresh_unavailable";
      try {
        const value = JSON.parse(text) as { error?: unknown };
        const permitted = ["mobile_confirmation_pending", "mobile_profile_unavailable", "mobile_profile_changed", "mobile_snapshot_unavailable", "mobile_registry_unavailable", "mobile_pairing_rate_limited", "mobile_device_limit", "mobile_profile_limit"];
        if (typeof value?.error === "string" && permitted.includes(value.error)) code = value.error;
      } catch { /* Only fixed error codes reach the caller. */ }
      throw new MobileConnectionError(code);
    }
    return text;
  } finally { clearTimeout(timer); }
}
function hex(value: unknown, length: number): value is string { return typeof value === "string" && value.length === length && /^[a-f0-9]+$/.test(value); }
export async function readMobileStatus(fetcher: Fetcher = fetch): Promise<MobileStatus> {
  const value = JSON.parse(await request("/api/status", 65536, fetcher)) as MobileStatus;
  if (!value || !hex(value.installationId, 32) || !hex(value.csrf, 64) || !Array.isArray(value.profiles) || value.profiles.length > 128 ||
    value.profiles.some(p => !p || !hex(p.id, 64) || !hex(p.epoch, 64) || typeof p.name !== "string" || p.name.length > 2048 || (p.icon !== null && typeof p.icon !== "string") || (p.refreshable!==undefined&&typeof p.refreshable!=="boolean")) || new Set(value.profiles.map(p => p.id)).size !== value.profiles.length) throw new MobileConnectionError("mobile_response_invalid");
  return value;
}
export async function redeemMobilePairing(code: string, label: string, fetcher: Fetcher = fetch): Promise<string> {
  if (!hex(code, 64) || !label.trim() || [...label].length > 60 || [...label].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new MobileConnectionError("mobile_pairing_invalid");
  const result = JSON.parse(await request("/api/pair/redeem", 4096, fetcher, { code, label })) as { claim: string };
  if (!hex(result.claim, 64)) throw new MobileConnectionError("mobile_response_invalid"); return result.claim;
}
export async function completeMobilePairing(claim: string, fetcher: Fetcher = fetch): Promise<void> {
  if (!hex(claim, 64)) throw new MobileConnectionError("mobile_pairing_invalid");
  const result = JSON.parse(await request("/api/pair/complete", 4096, fetcher, { claim })) as { paired: boolean };
  if (result.paired !== true) throw new MobileConnectionError("mobile_response_invalid");
}
/** The binding comes from authenticated status; changing an existing epoch requires
 * explicit approval from the caller. Nothing in snapshot JSON can authorize that change. */
export async function refreshMobileSnapshot(repository: Pick<MobileRepository, "prepareRefresh" | "replace">, binding: SnapshotBinding, options: { replaceEpoch?: string; accessFence?:string } = {}, fetcher: Fetcher = fetch): Promise<"saved" | "unchanged"> {
  if (!hex(binding.installationId, 32) || !hex(binding.profileId, 64) || !hex(binding.epoch, 64)) throw new MobileConnectionError("mobile_binding_invalid");
  const id = `${binding.installationId}/${binding.profileId}`;
  if (pending.has(id)) throw new MobileConnectionError("mobile_refresh_busy"); pending.add(id);
  try {
    const guard = await repository.prepareRefresh(binding);
    if(options.accessFence!==undefined&&guard.fence!==options.accessFence)throw new MobileConnectionError("mobile_access_forgotten");
    const json = await request(`/api/snapshot/${binding.profileId}`, MAX_MOBILE_SNAPSHOT_BYTES, fetcher);
    return await repository.replace(json, binding, { ...(options.replaceEpoch?{replaceEpoch:options.replaceEpoch}:{}), guard });
  } finally { pending.delete(id); }
}
export async function logoutMobile(csrf: string, fetcher: Fetcher = fetch): Promise<void> {
  if (!hex(csrf, 64)) throw new MobileConnectionError("mobile_csrf_invalid");
  await request("/api/logout", 4096, fetcher, {}, csrf);
}
