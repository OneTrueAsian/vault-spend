import { invoke } from "@tauri-apps/api/core";
export interface SignedUpdateOffer {
  handle: string;
  version: string;
  size: number;
}
export const updateHandle = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export async function prepareSignedUpdate(): Promise<SignedUpdateOffer | null> {
  const value: unknown = await invoke("prepare_signed_update");
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    !("handle" in value) ||
    !updateHandle(value.handle) ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version) ||
    !("size" in value) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > 128 * 1024 * 1024
  )
    throw Error("The signed update response is invalid. Use the official release page.");
  return value as SignedUpdateOffer;
}
export async function downloadSignedUpdate(handle: string): Promise<string> {
  const token: unknown = await invoke("download_signed_update", { handle });
  if (!updateHandle(token)) throw Error("The verified installer response is invalid. Check again.");
  return token;
}
export const cancelSignedUpdate = (handle: string) => invoke<void>("cancel_signed_update", { handle });
export const installSignedUpdate = (token: string) => invoke<void>("install_signed_update", { token });
